import { connect, type NatsConnection, StringCodec } from "nats"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startRunnerSubscriber } from "../../src/pipeline/subscriber.js"
import type { TPipelineResult, TStepResult } from "../../src/pipeline/types.js"

describe("pipeline end-to-end via NATS", () => {
  let nats: NatsConnection
  const sc = StringCodec()

  beforeAll(async () => {
    nats = await connect({ servers: "nats://localhost:4222" })
  })

  afterAll(async () => {
    await nats.drain()
  })

  it("receives resolved pipeline, executes steps, publishes result", async () => {
    const stepProgress: TStepResult[] = []

    const progressSub = nats.subscribe("gittan.pipeline.step-progress")
    const progressCollector = (async () => {
      for await (const msg of progressSub) {
        stepProgress.push(JSON.parse(sc.decode(msg.data)))
        if (stepProgress.length >= 2) {
          progressSub.unsubscribe()
          return
        }
      }
    })()

    const resultSub = nats.subscribe("gittan.pipeline.result")
    const resultPromise = (async () => {
      for await (const msg of resultSub) {
        resultSub.unsubscribe()
        return JSON.parse(sc.decode(msg.data)) as TPipelineResult
      }
    })()

    startRunnerSubscriber({
      nats,
      config: {
        natsUrl: "nats://localhost:4222",
        forgejoUrl: "http://localhost:3333",
        workDir: "/tmp/gittan-runner-test",
      },
      stepRunner: async (step) => ({
        stepName: step.name,
        status: "passed",
        durationMs: 5,
        exitCode: 0,
        output: `mock: ${step.name} completed`,
        source: step.source,
      }),
      cloneRepo: async () => "/tmp/gittan-runner-test",
    })

    const resolvedPipeline = {
      pushEventId: "push-e2e-test",
      repoId: "repo-1",
      branch: "main",
      isGated: true,
      resolved: {
        steps: [
          {
            name: "lint",
            image: "node:22-slim",
            run: "npm run lint",
            timeout: "5m",
            source: "repo",
          },
          {
            name: "test",
            image: "node:22-slim",
            run: "npm test",
            timeout: "10m",
            source: "repo",
          },
        ],
        resolvedFrom: {
          policies: [],
          repoConfig: true,
        },
      },
    }

    nats.publish(
      "gittan.pipeline.resolved",
      sc.encode(JSON.stringify(resolvedPipeline)),
    )

    const result = await resultPromise
    await progressCollector

    expect(result).toBeDefined()
    expect(result!.pushEventId).toBe("push-e2e-test")
    expect(result!.status).toBe("passed")
    expect(result!.isGated).toBe(true)
    expect(result!.steps).toHaveLength(2)
    expect(result!.steps[0].stepName).toBe("lint")
    expect(result!.steps[0].status).toBe("passed")
    expect(result!.steps[1].stepName).toBe("test")
    expect(result!.steps[1].status).toBe("passed")
    expect(result!.durationMs).toBeGreaterThanOrEqual(0)

    expect(stepProgress).toHaveLength(2)
    expect(stepProgress[0].stepName).toBe("lint")
    expect(stepProgress[1].stepName).toBe("test")
  })

  it("publishes failure result when step fails", async () => {
    const nats2 = await connect({ servers: "nats://localhost:4222" })

    const resultSub = nats2.subscribe("gittan.pipeline.result")
    const resultPromise = (async () => {
      for await (const msg of resultSub) {
        resultSub.unsubscribe()
        return JSON.parse(sc.decode(msg.data)) as TPipelineResult
      }
    })()

    startRunnerSubscriber({
      nats: nats2,
      config: {
        natsUrl: "nats://localhost:4222",
        forgejoUrl: "http://localhost:3333",
        workDir: "/tmp/gittan-runner-test-fail",
      },
      stepRunner: async (step) => ({
        stepName: step.name,
        status: step.name === "test" ? "failed" : "passed",
        durationMs: 5,
        exitCode: step.name === "test" ? 1 : 0,
        error: step.name === "test" ? "assertion failed" : undefined,
        source: step.source,
      }),
      cloneRepo: async () => "/tmp/gittan-runner-test-fail",
    })

    nats2.publish(
      "gittan.pipeline.resolved",
      sc.encode(
        JSON.stringify({
          pushEventId: "push-fail-test",
          repoId: "repo-1",
          branch: "main",
          isGated: true,
          resolved: {
            steps: [
              { name: "test", image: "node:22", run: "npm test", timeout: "10m", source: "repo" },
              { name: "deploy", image: "node:22", run: "./deploy.sh", timeout: "5m", source: "repo", needs: ["test"] },
            ],
            resolvedFrom: { policies: [], repoConfig: true },
          },
        }),
      ),
    )

    const result = await resultPromise
    expect(result!.status).toBe("failed")
    expect(result!.steps[0].status).toBe("failed")
    expect(result!.steps[1].status).toBe("skipped")

    await nats2.drain()
  })
})
