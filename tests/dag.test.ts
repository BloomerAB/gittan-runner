import { describe, expect, it } from "vitest"

import { buildDAG } from "../src/pipeline/dag.js"
import type { TResolvedStep } from "../src/pipeline/types.js"

const step = (
  name: string,
  needs?: string[],
): TResolvedStep => ({
  name,
  image: "node:22-slim",
  run: `echo ${name}`,
  needs,
  timeout: "10m",
  source: "repo",
})

describe("buildDAG", () => {
  it("returns empty for no steps", () => {
    expect(buildDAG([])).toEqual([])
  })

  it("puts independent steps in one stage", () => {
    const stages = buildDAG([step("lint"), step("test")])

    expect(stages).toHaveLength(1)
    expect(stages[0]).toHaveLength(2)
  })

  it("orders dependent steps into sequential stages", () => {
    const stages = buildDAG([
      step("test"),
      step("build", ["test"]),
      step("deploy", ["build"]),
    ])

    expect(stages).toHaveLength(3)
    expect(stages[0][0].name).toBe("test")
    expect(stages[1][0].name).toBe("build")
    expect(stages[2][0].name).toBe("deploy")
  })

  it("parallelizes independent branches", () => {
    const stages = buildDAG([
      step("lint"),
      step("test"),
      step("build", ["test"]),
      step("deploy", ["build", "lint"]),
    ])

    expect(stages).toHaveLength(3)
    expect(stages[0].map((s) => s.name).sort()).toEqual(["lint", "test"])
    expect(stages[1][0].name).toBe("build")
    expect(stages[2][0].name).toBe("deploy")
  })

  it("handles diamond dependency", () => {
    const stages = buildDAG([
      step("install"),
      step("lint", ["install"]),
      step("test", ["install"]),
      step("build", ["lint", "test"]),
    ])

    expect(stages).toHaveLength(3)
    expect(stages[0][0].name).toBe("install")
    expect(stages[1].map((s) => s.name).sort()).toEqual(["lint", "test"])
    expect(stages[2][0].name).toBe("build")
  })

  it("throws on circular dependency", () => {
    expect(() =>
      buildDAG([step("a", ["b"]), step("b", ["a"])]),
    ).toThrow("Circular dependency")
  })

  it("throws on self-dependency", () => {
    expect(() => buildDAG([step("a", ["a"])])).toThrow("Circular dependency")
  })

  it("handles complex multi-branch DAG", () => {
    const stages = buildDAG([
      step("install"),
      step("lint", ["install"]),
      step("unit-test", ["install"]),
      step("integration-test", ["install"]),
      step("build", ["lint", "unit-test"]),
      step("e2e", ["build"]),
      step("deploy", ["e2e", "integration-test"]),
    ])

    expect(stages).toHaveLength(5)
    expect(stages[0][0].name).toBe("install")
    expect(stages[1].map((s) => s.name).sort()).toEqual([
      "integration-test",
      "lint",
      "unit-test",
    ])
    expect(stages[2][0].name).toBe("build")
    expect(stages[3][0].name).toBe("e2e")
    expect(stages[4][0].name).toBe("deploy")
  })
})
