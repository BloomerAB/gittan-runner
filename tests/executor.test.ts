import { describe, expect, it, vi } from "vitest"

import {
  executePipeline,
  type TStepRunner,
} from "../src/pipeline/executor.js"
import type {
  TResolvedPipelineMessage,
  TResolvedStep,
  TStepResult,
} from "../src/pipeline/types.js"

const step = (
  name: string,
  opts?: Partial<TResolvedStep>,
): TResolvedStep => ({
  name,
  image: "node:22-slim",
  run: `echo ${name}`,
  timeout: "10m",
  source: "repo",
  ...opts,
})

const makeMessage = (
  steps: TResolvedStep[],
  branch = "main",
): TResolvedPipelineMessage => ({
  pushEventId: "push-123",
  repoId: "repo-1",
  branch,
  isGated: true,
  resolved: {
    steps,
    resolvedFrom: { policies: [], repoConfig: true },
  },
})

const passingRunner: TStepRunner = async (s) => ({
  stepName: s.name,
  status: "passed",
  durationMs: 10,
  exitCode: 0,
  output: `${s.name} done`,
  source: s.source,
})

const failingRunner =
  (failStep: string): TStepRunner =>
  async (s) => ({
    stepName: s.name,
    status: s.name === failStep ? "failed" : "passed",
    durationMs: 10,
    exitCode: s.name === failStep ? 1 : 0,
    error: s.name === failStep ? "test failed" : undefined,
    source: s.source,
  })

describe("executePipeline", () => {
  it("runs all steps and returns passed", async () => {
    const result = await executePipeline(
      makeMessage([step("test"), step("build", { needs: ["test"] })]),
      passingRunner,
      "/tmp/test",
    )

    expect(result.status).toBe("passed")
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].stepName).toBe("test")
    expect(result.steps[0].status).toBe("passed")
    expect(result.steps[1].stepName).toBe("build")
    expect(result.steps[1].status).toBe("passed")
    expect(result.pushEventId).toBe("push-123")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("fails pipeline and skips subsequent stages on failure", async () => {
    const result = await executePipeline(
      makeMessage([
        step("test"),
        step("build", { needs: ["test"] }),
        step("deploy", { needs: ["build"] }),
      ]),
      failingRunner("test"),
      "/tmp/test",
    )

    expect(result.status).toBe("failed")
    expect(result.steps[0].status).toBe("failed")
    expect(result.steps[1].status).toBe("skipped")
    expect(result.steps[2].status).toBe("skipped")
  })

  it("runs parallel steps and fails if any fail", async () => {
    const result = await executePipeline(
      makeMessage([
        step("lint"),
        step("test"),
        step("build", { needs: ["lint", "test"] }),
      ]),
      failingRunner("test"),
      "/tmp/test",
    )

    expect(result.status).toBe("failed")
    expect(result.steps.find((s) => s.stepName === "lint")!.status).toBe("passed")
    expect(result.steps.find((s) => s.stepName === "test")!.status).toBe("failed")
    expect(result.steps.find((s) => s.stepName === "build")!.status).toBe("skipped")
  })

  it("skips steps with only filter that doesn't match branch", async () => {
    const result = await executePipeline(
      makeMessage(
        [
          step("test"),
          step("deploy", { needs: ["test"], only: "main" }),
        ],
        "feat/new-auth",
      ),
      passingRunner,
      "/tmp/test",
    )

    expect(result.status).toBe("passed")
    expect(result.steps.find((s) => s.stepName === "deploy")!.status).toBe("skipped")
  })

  it("runs steps with matching only filter", async () => {
    const result = await executePipeline(
      makeMessage([
        step("test"),
        step("deploy", { needs: ["test"], only: "main" }),
      ]),
      passingRunner,
      "/tmp/test",
    )

    expect(result.steps.find((s) => s.stepName === "deploy")!.status).toBe("passed")
  })

  it("calls progress callback for each step", async () => {
    const progress: TStepResult[] = []

    await executePipeline(
      makeMessage([
        step("lint"),
        step("test"),
        step("build", { needs: ["lint", "test"] }),
      ]),
      passingRunner,
      "/tmp/test",
      (result) => progress.push(result),
    )

    expect(progress).toHaveLength(3)
    expect(progress.map((p) => p.stepName)).toEqual(
      expect.arrayContaining(["lint", "test", "build"]),
    )
  })

  it("tracks step source in results", async () => {
    const result = await executePipeline(
      makeMessage([
        step("audit", { source: "policy" }),
        step("test", { source: "repo" }),
        step("scan", { source: "policy", needs: ["test"] }),
      ]),
      passingRunner,
      "/tmp/test",
    )

    expect(result.steps.find((s) => s.stepName === "audit")!.source).toBe("policy")
    expect(result.steps.find((s) => s.stepName === "test")!.source).toBe("repo")
    expect(result.steps.find((s) => s.stepName === "scan")!.source).toBe("policy")
  })

  it("handles empty pipeline", async () => {
    const result = await executePipeline(
      makeMessage([]),
      passingRunner,
      "/tmp/test",
    )

    expect(result.status).toBe("passed")
    expect(result.steps).toEqual([])
  })
})
