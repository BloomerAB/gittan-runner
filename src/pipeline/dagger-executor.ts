import { connect, ExecError, type Container, type Client, type Directory } from "@dagger.io/dagger"

import { buildDAG } from "./dag.js"
import { resolveImage } from "./image-resolver.js"
import {
  annotateExpiredError,
  expiredStepResult,
  isTokenExpired,
} from "./workload-token.js"
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
  orgSlug: string,
  inputWorkspace?: Directory,
  secrets?: Record<string, string>,
): Promise<TStepOutput> => {
  const publish = step.publish!
  const startTime = Date.now()

  try {
    const src = inputWorkspace ?? client.host().directory(sourceDir)
    const tag = generateTag(commitSha)
    const registryUrl = secrets?.REGISTRY_URL ?? "images.gittan.eu"
    const imageRef = `${registryUrl}/${orgSlug}/${publish.image}:${tag}`

    // Never pass REGISTRY_TOKEN (or registry coordinates) as a build arg — build
    // args are baked into the image history. The token reaches the build as a
    // BuildKit secret mount (/run/secrets/registry-token) instead, so Dockerfiles
    // can install from npm.gittan.eu without leaking the credential into a layer.
    const buildArgs = secrets
      ? Object.entries(secrets)
          .filter(([key]) => key !== "REGISTRY_TOKEN" && key !== "REGISTRY_URL" && key !== "REGISTRY_USER")
          .map(([name, value]) => ({ name, value }))
      : []

    const registryToken = secrets?.REGISTRY_TOKEN
      ? client.setSecret("registry-token", secrets.REGISTRY_TOKEN)
      : undefined

    let built = src.dockerBuild({
      dockerfile: publish.dockerfile,
      buildArgs,
      secrets: registryToken ? [registryToken] : [],
    })

    if (registryToken) {
      built = built.withRegistryAuth(
        registryUrl,
        secrets?.REGISTRY_USER ?? "gittan-admin",
        registryToken,
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
      // NOTE: we deliberately do NOT mutate the workspace .npmrc here. Secrets are
      // available as env vars, and a repo that needs a private registry declares it
      // in its committed .npmrc referencing ${TOKEN} (e.g. ${REGISTRY_TOKEN} for
      // npm.gittan.eu, ${NPM_TOKEN} for GitHub Packages). Appending an auth line to
      // the workspace .npmrc leaked into the publish Docker build context (where
      // NPM_TOKEN is unset), which broke pnpm's env-substitution and dropped ALL
      // registry auth — failing the @gittan/types tarball with 401.
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
  workloadTokenExpiresAt?: string,
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

          // Pre-check: a registry-bound step (one carrying the workload token)
          // is refused outright once the token's 30-minute TTL has passed —
          // attempting it would only surface a cryptic registry 401.
          if (
            secrets?.REGISTRY_TOKEN &&
            workloadTokenExpiresAt &&
            isTokenExpired(workloadTokenExpiresAt, Date.now())
          ) {
            const result = expiredStepResult(step, workloadTokenExpiresAt)
            onProgress?.(result)
            return { result } as TStepOutput
          }

          const output = step.publish
            ? await runPublishStep(
                client, step, sourceDir,
                message.commitSha ?? message.pushEventId,
                message.orgName ?? message.orgId,
                currentWorkspace, secrets,
              )
            : await runStepWithDagger(client, step, sourceDir, message.orgId, currentWorkspace, secrets)

          // Post-failure annotation: a failure that lands after the token has
          // expired (e.g. a registry 401 mid-step) is relabelled as a TTL limit.
          const result = annotateExpiredError(output.result, workloadTokenExpiresAt, Date.now())
          onProgress?.(result)
          return { ...output, result }
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
