export type TResolvedStep = {
  readonly name: string
  readonly image?: string
  readonly use?: string
  readonly with?: Record<string, string>
  readonly run?: string
  readonly needs?: ReadonlyArray<string>
  readonly only?: string
  readonly cache?: ReadonlyArray<string>
  readonly artifacts?: ReadonlyArray<string>
  readonly secrets?: ReadonlyArray<string>
  readonly timeout: string
  readonly source: "repo" | "policy" | "template"
  readonly policyName?: string
}

export type TResolvedPipelineMessage = {
  readonly pushEventId: string
  readonly repoId: string
  readonly branch: string
  readonly isGated: boolean
  readonly resolved: {
    readonly steps: ReadonlyArray<TResolvedStep>
    readonly resolvedFrom: {
      readonly policies: ReadonlyArray<string>
      readonly template?: string
      readonly repoConfig: boolean
    }
  }
}

export type TStepResult = {
  readonly stepName: string
  readonly status: "passed" | "failed" | "skipped"
  readonly durationMs: number
  readonly exitCode?: number
  readonly output?: string
  readonly error?: string
  readonly source: "repo" | "policy" | "template"
}

export type TPipelineResult = {
  readonly pushEventId: string
  readonly repoId: string
  readonly branch: string
  readonly isGated: boolean
  readonly status: "passed" | "failed"
  readonly steps: ReadonlyArray<TStepResult>
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
}
