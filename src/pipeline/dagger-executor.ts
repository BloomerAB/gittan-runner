import { connect, ExecError, type Container, type Client, type Directory } from "@dagger.io/dagger"

import { buildDAG } from "./dag.js"
import { resolveImage } from "./image-resolver.js"
import type {
  TPipelineResult,
  TResolvedPipelineMessage,
  TResolvedStep,
  TStepResult,
} from "./types.js"

export type TProgressCallback = (stepResult: TStepResult) => void

type TStepOutput = {
  readonly result: TStepResult
  readonly workspace?: Directory
}

const CACHE_PATH_MAP: Record<string, string> = {
  node_modules: "/root/.local/share/pnpm/store",
  ".pnpm-store": "/root/.local/share/pnpm/store",
  ".npm": "/root/.npm",
  ".cache/pip": "/root/.cache/pip",
  ".cache/uv": "/root/.cache/uv",
} as const

const generateTag = (sha: string): string => {
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0")
  const d = String(now.getUTCDate()).padStart(2, "0")
  const h = String(now.getUTCHours()).padStart(2, "0")
  const mi = String(now.getUTCMinutes()).padStart(2, "0")
  const s = String(now.getUTCSeconds()).padStart(2, "0")
  return `${y}${mo}${d}-${h}${mi}${s}-${sha.slice(0, 7)}`
}

const runPublishStep = async (
  client: Client,
  step: TResolvedStep,
  sourceDir: string,
  commitSha: string,
  inputWorkspace?: Directory,
  secrets?: Record<string, string>,
): Promise<TStepOutput> => {
  const publish = step.publish!
  const startTime = Date.now()

  try {
    const src = inputWorkspace ?? client.host().directory(sourceDir)
    const tag = generateTag(commitSha)
    const registryUrl = secrets?.REGISTRY_URL ?? "git.gittan.eu"
    const imageRef = `${registryUrl}/${publish.image}:${tag}`

    const buildArgs = secrets
      ? Object.entries(secrets)
          .filter(([key]) => key !== "REGISTRY_TOKEN" && key !== "REGISTRY_URL" && key !== "REGISTRY_USER")
          .map(([name, value]) => ({ name, value }))
      : []

    let built = src.dockerBuild({ dockerfile: publish.dockerfile, buildArgs })

    if (secrets?.REGISTRY_TOKEN) {
      built = built.withRegistryAuth(
        registryUrl,
        secrets.REGISTRY_USER ?? "gittan-admin",
        client.setSecret("registry-token", secrets.REGISTRY_TOKEN),
      )
    }

    const digest = await built.publish(imageRef)
    const durationMs = Date.now() - startTime

    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "passed",
        durationMs,
        exitCode: 0,
        output: `Published ${imageRef}\nDigest: ${digest}`,
        source: step.source,
      },
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "failed",
        durationMs,
        exitCode: 1,
        error: message,
        source: step.source,
      },
    }
  }
}

const runStepWithDagger = async (
  client: Client,
  step: TResolvedStep,
  sourceDir: string,
  orgId: string,
  inputWorkspace?: Directory,
  secrets?: Record<string, string>,
): Promise<TStepOutput> => {
  if (!step.image || !step.run) {
    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "skipped",
        durationMs: 0,
        source: step.source,
        output: "No image or run command specified",
      },
    }
  }

  const imageValidation = resolveImage(step.image)
  if (!imageValidation.valid) {
    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "failed",
        durationMs: 0,
        source: step.source,
        error: imageValidation.reason,
      },
    }
  }

  const startTime = Date.now()

  try {
    const src = inputWorkspace ?? client.host().directory(sourceDir)

    let container: Container = client
      .container()
      .from(imageValidation.resolved)
      .withDirectory("/workspace", src)
      .withWorkdir("/workspace")

    for (const cachePath of step.cache ?? []) {
      const mountPath = CACHE_PATH_MAP[cachePath] ?? `/workspace/${cachePath}`
      const volumeName = `${orgId}-${cachePath.replace(/[^a-zA-Z0-9]/g, "-")}`
      container = container.withMountedCache(mountPath, client.cacheVolume(volumeName))
    }

    if (secrets) {
      for (const [key, value] of Object.entries(secrets)) {
        container = container.withSecretVariable(key, client.setSecret(key, value))
      }
      if (secrets.NPM_TOKEN) {
        container = container.withExec([
          "sh", "-c",
          'echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc',
        ])
      }
    }

    const needsCorepack = imageValidation.resolved.includes("node")
    const runCmd = needsCorepack && !step.run.includes("corepack")
      ? `corepack enable && ${step.run}`
      : step.run
    const executed = container.withExec(["sh", "-c", runCmd])

    const stdout = await executed.stdout()
    const stderr = await executed.stderr()
    const durationMs = Date.now() - startTime

    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "passed",
        durationMs,
        exitCode: 0,
        output: [stdout, stderr].filter(Boolean).join("\n"),
        source: step.source,
      },
      workspace: executed.directory("/workspace"),
    }
  } catch (err) {
    const durationMs = Date.now() - startTime

    if (err instanceof ExecError) {
      return {
        result: {
          stepName: step.name,
          description: step.description,
          status: "failed",
          durationMs,
          exitCode: err.exitCode ?? 1,
          error: err.stderr || err.stdout || err.message,
          output: err.stdout || undefined,
          source: step.source,
        },
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    return {
      result: {
        stepName: step.name,
        description: step.description,
        status: "failed",
        durationMs,
        exitCode: 1,
        error: message,
        source: step.source,
      },
    }
  }
}

export const executePipelineWithDagger = async (
  message: TResolvedPipelineMessage,
  sourceDir: string,
  onProgress?: TProgressCallback,
  secrets?: Record<string, string>,
): Promise<TPipelineResult> => {
  const startedAt = new Date().toISOString()
  const startTime = Date.now()
  const stages = buildDAG(message.resolved.steps)

  const allResults: TStepResult[] = []
  let pipelinePassed = true
  let currentWorkspace: Directory | undefined

  await connect(async (client: Client) => {
    for (const stage of stages) {
      if (!pipelinePassed) {
        const skipped = stage.map((step) => ({
          stepName: step.name,
          description: step.description,
          status: "skipped" as const,
          durationMs: 0,
          source: step.source,
        }))
        allResults.push(...skipped)
        skipped.forEach((r) => onProgress?.(r))
        continue
      }

      const branchFilter = (step: TResolvedStep): boolean => {
        if (!step.only) return true
        return step.only === message.branch
      }

      const outputs = await Promise.all(
        stage.map(async (step) => {
          if (!branchFilter(step)) {
            const result: TStepResult = {
              stepName: step.name,
              description: step.description,
              status: "skipped",
              durationMs: 0,
              source: step.source,
            }
            onProgress?.(result)
            return { result } as TStepOutput
          }

          if (step.publish) {
            const output = await runPublishStep(
              client, step, sourceDir,
              message.commitSha ?? message.pushEventId,
              currentWorkspace, secrets,
            )
            onProgress?.(output.result)
            return output
          }

          const output = await runStepWithDagger(client, step, sourceDir, message.orgId, currentWorkspace, secrets)
          onProgress?.(output.result)
          return output
        }),
      )

      allResults.push(...outputs.map((o) => o.result))

      if (outputs.some((o) => o.result.status === "failed")) {
        pipelinePassed = false
      } else {
        const successfulWorkspace = outputs.find((o) => o.workspace)?.workspace
        if (successfulWorkspace) {
          currentWorkspace = successfulWorkspace
        }
      }
    }
  })

  const finishedAt = new Date().toISOString()

  return {
    pushEventId: message.pushEventId,
    orgId: message.orgId,
    teamId: message.teamId,
    repoId: message.repoId,
    branch: message.branch,
    isGated: message.isGated,
    commitSha: message.commitSha,
    commitMessage: message.commitMessage,
    pusher: message.pusher,
    status: pipelinePassed ? "passed" : "failed",
    steps: allResults,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startTime,
  }
}
