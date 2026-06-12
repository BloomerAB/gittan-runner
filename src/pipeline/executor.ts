import { execFile } from "node:child_process"

import { buildDAG } from "./dag.js"
import type {
  TPipelineResult,
  TResolvedPipelineMessage,
  TResolvedStep,
  TStepResult,
} from "./types.js"

export type TStepRunner = (
  step: TResolvedStep,
  workDir: string,
) => Promise<TStepResult>

export type TProgressCallback = (stepResult: TStepResult) => void

export const createDockerStepRunner = (): TStepRunner =>
  async (step, workDir) => {
    if (!step.image || !step.run) {
      return {
        stepName: step.name,
        status: "skipped",
        durationMs: 0,
        source: step.source,
        output: "No image or run command specified",
      }
    }

    const startTime = Date.now()

    try {
      const { stdout, stderr, exitCode } = await runContainer(
        step.image,
        step.run,
        workDir,
        parseTimeout(step.timeout),
      )

      const durationMs = Date.now() - startTime

      return {
        stepName: step.name,
        status: exitCode === 0 ? "passed" : "failed",
        durationMs,
        exitCode,
        output: stdout,
        error: stderr || undefined,
        source: step.source,
      }
    } catch (err) {
      return {
        stepName: step.name,
        status: "failed",
        durationMs: Date.now() - startTime,
        exitCode: -1,
        error: err instanceof Error ? err.message : String(err),
        source: step.source,
      }
    }
  }

const runContainer = (
  image: string,
  command: string,
  workDir: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
  new Promise((resolve, reject) => {
    const args = [
      "run",
      "--rm",
      "-v",
      `${workDir}:/workspace`,
      "-w",
      "/workspace",
      image,
      "sh",
      "-c",
      command,
    ]

    const proc = execFile("docker", args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && "killed" in error && error.killed) {
        reject(new Error(`Step timed out after ${timeoutMs}ms`))
        return
      }

      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error?.code
          ? (typeof error.code === "number" ? error.code : 1)
          : 0,
      })
    })
  })

const parseTimeout = (timeout: string): number => {
  const match = timeout.match(/^(\d+)(s|m|h)$/)
  if (!match) return 600_000

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case "s":
      return value * 1000
    case "m":
      return value * 60 * 1000
    case "h":
      return value * 60 * 60 * 1000
    default:
      return 600_000
  }
}

export const executePipeline = async (
  message: TResolvedPipelineMessage,
  stepRunner: TStepRunner,
  workDir: string,
  onProgress?: TProgressCallback,
): Promise<TPipelineResult> => {
  const startedAt = new Date().toISOString()
  const startTime = Date.now()
  const stages = buildDAG(message.resolved.steps)
  const allResults: TStepResult[] = []
  let pipelinePassed = true

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
          const result: TStepResult = {
            stepName: step.name,
            status: "skipped",
            durationMs: 0,
            source: step.source,
          }
          onProgress?.(result)
          return result
        }

        const result = await stepRunner(step, workDir)
        onProgress?.(result)
        return result
      }),
    )

    allResults.push(...results)

    if (results.some((r) => r.status === "failed")) {
      pipelinePassed = false
    }
  }

  const finishedAt = new Date().toISOString()

  return {
    pushEventId: message.pushEventId,
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
