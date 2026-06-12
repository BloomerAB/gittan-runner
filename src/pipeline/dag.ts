import type { TResolvedStep } from "./types.js"

export type TExecutionStage = ReadonlyArray<TResolvedStep>

export const buildDAG = (
  steps: ReadonlyArray<TResolvedStep>,
): ReadonlyArray<TExecutionStage> => {
  if (steps.length === 0) return []

  const stepMap = new Map(steps.map((s) => [s.name, s]))
  const resolved = new Set<string>()
  const stages: TExecutionStage[] = []

  let remaining = [...steps]
  let iterations = 0
  const maxIterations = steps.length + 1

  while (remaining.length > 0 && iterations < maxIterations) {
    iterations++

    const ready = remaining.filter((step) => {
      const deps = step.needs ?? []
      return deps.every((d) => resolved.has(d))
    })

    if (ready.length === 0) {
      throw new Error(
        `Circular dependency detected. Unresolvable steps: ${remaining.map((s) => s.name).join(", ")}`,
      )
    }

    stages.push(ready)
    ready.forEach((s) => resolved.add(s.name))
    remaining = remaining.filter((s) => !resolved.has(s.name))
  }

  return stages
}
