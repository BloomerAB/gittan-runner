import { connect, ExecError, type Container, type Client } from "@dagger.io/dagger"

import { buildDAG } from "./dag.js"
import { resolveImage } from "./image-resolver.js"
import type {
  TPipelineResult,
  TResolvedPipelineMessage,
  TResolvedStep,
  TStepResult,
} from "./types.js"

export type TProgressCallback = (stepResult: TStepResult) => void

const CACHE_PATH_MAP: Record<string, string> = {
  node_modules: "/root/.local/share/pnpm/store",
  ".pnpm-store": "/root/.local/share/pnpm/store",
  ".npm": "/root/.npm",
  ".cache/pip": "/root/.cache/pip",
  ".cache/uv": "/root/.cache/uv",
} as const

const runStepWithDagger = async (
  client: Client,
  step: TResolvedStep,
  sourceDir: string,
  orgId: string,
  secrets?: Record<string, string>,
): Promise<TStepResult> => {
  if (!step.image || !step.run) {
    return {
      stepName: step.name,
      status: "skipped",
      durationMs: 0,
      source: step.source,
      output: "No image or run command specified",
    }
  }

  const imageValidation = resolveImage(step.image)
  if (!imageValidation.valid) {
    return {
      stepName: step.name,
      status: "failed",
      durationMs: 0,
      source: step.source,
      error: imageValidation.reason,
    }
  }

  const startTime = Date.now()

  try {
    const src = client.host().directory(sourceDir)

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
    }

    const executed = container.withExec(["sh", "-c", step.run])

    const stdout = await executed.stdout()
    const stderr = await executed.stderr()
    const durationMs = Date.now() - startTime

    return {
      stepName: step.name,
      status: "passed",
      durationMs,
      exitCode: 0,
      output: [stdout, stderr].filter(Boolean).join("\n"),
      source: step.source,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime

    if (err instanceof ExecError) {
      return {
        stepName: step.name,
        status: "failed",
        durationMs,
        exitCode: err.exitCode ?? 1,
        error: err.stderr || err.stdout || err.message,
        output: err.stdout || undefined,
        source: step.source,
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    return {
      stepName: step.name,
      status: "failed",
      durationMs,
      exitCode: 1,
      error: message,
      source: step.source,
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

  await connect(async (client: Client) => {
    for (const stage of stages) {
      if (!pipelinePassed) {
        const skipped = stage.map((step) => ({
          stepName: step.name,
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

      const results = await Promise.all(
        stage.map(async (step) => {
          if (!branchFilter(step)) {
            const stepResult: TStepResult = {
              stepName: step.name,
              status: "skipped",
              durationMs: 0,
              source: step.source,
            }
            onProgress?.(stepResult)
            return stepResult
          }

          const stepResult = await runStepWithDagger(client, step, sourceDir, message.orgId, secrets)
          onProgress?.(stepResult)
          return stepResult
        }),
      )

      allResults.push(...results)

      if (results.some((r) => r.status === "failed")) {
        pipelinePassed = false
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
    status: pipelinePassed ? "passed" : "failed",
    steps: allResults,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startTime,
  }
}
