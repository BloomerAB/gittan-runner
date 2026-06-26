import { mkdir, rm } from "node:fs/promises"

import type { NatsConnection } from "nats"
import { StringCodec } from "nats"

import type { TConfig } from "../config.js"
import { executePipelineWithDagger } from "./dagger-executor.js"
import type { TResolvedPipelineMessage, TStepResult } from "./types.js"

export type TRunnerSubscriberDeps = {
  readonly nats: NatsConnection
  readonly config: TConfig
  readonly cloneRepo: (
    forgejoUrl: string,
    repoFullName: string,
    branch: string,
    workDir: string,
    token?: string,
  ) => Promise<string>
}

export const startRunnerSubscriber = (deps: TRunnerSubscriberDeps): void => {
  const sc = StringCodec()

  const sub = deps.nats.subscribe("gittan.pipeline.resolved")
  ;(async () => {
    for await (const msg of sub) {
      try {
        const message: TResolvedPipelineMessage = JSON.parse(
          sc.decode(msg.data),
        )

        if (message.resolved.steps.length === 0) {
          deps.nats.publish(
            "gittan.pipeline.result",
            sc.encode(
              JSON.stringify({
                pushEventId: message.pushEventId,
                orgId: message.orgId,
                teamId: message.teamId,
                repoId: message.repoId,
                branch: message.branch,
                isGated: message.isGated,
                status: "passed",
                steps: [],
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
              }),
            ),
          )
          continue
        }

        const workDir = `${deps.config.workDir}/${message.pushEventId}`
        await mkdir(workDir, { recursive: true })

        const repoPath = message.forgejoFullName ?? `${message.orgId}/${message.repoName ?? message.repoId}`
        const sourceDir = await deps.cloneRepo(
          deps.config.forgejoUrl,
          repoPath,
          message.branch,
          workDir,
          deps.config.forgejoToken,
        )

        const result = await executePipelineWithDagger(
          message,
          sourceDir,
          (stepResult: TStepResult) => {
            deps.nats.publish(
              "gittan.pipeline.step-progress",
              sc.encode(
                JSON.stringify({
                  pushEventId: message.pushEventId,
                  repoId: message.repoId,
                  ...stepResult,
                }),
              ),
            )
          },
        )

        deps.nats.publish(
          "gittan.pipeline.result",
          sc.encode(JSON.stringify(result)),
        )

        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      } catch (err) {
        console.error("Pipeline execution failed:", err)
      }
    }
  })()
}
