import type { TResolvedStep, TStepResult } from "./types.js"

// Built exactly so a token-TTL failure can never be mistaken for a build/code
// failure: the gateway returns a generic 401 on an expired workload token, and
// without this annotation that reads as a cryptic auth error.
export const workloadTokenExpiredMessage = (expiresAt: string): string =>
  `Workload token expired at ${expiresAt} — this pipeline run exceeded the 30-minute token lifetime. This is a token-TTL limit, not a build/code failure.`

export const isTokenExpired = (
  expiresAt: string | undefined,
  now: number,
): boolean => {
  if (!expiresAt) return false
  const expiryMs = Date.parse(expiresAt)
  if (Number.isNaN(expiryMs)) return false
  return now >= expiryMs
}

// Result for a registry-bound step we refuse to even attempt because the
// workload token is already expired. durationMs 0 signals "not executed".
export const expiredStepResult = (
  step: TResolvedStep,
  expiresAt: string,
): TStepResult => ({
  stepName: step.name,
  description: step.description,
  status: "failed",
  durationMs: 0,
  exitCode: 1,
  error: workloadTokenExpiredMessage(expiresAt),
  source: step.source,
})

// Post-failure annotation: a step that failed for any reason while the token was
// already expired gets its error replaced with the unambiguous TTL message.
export const annotateExpiredError = (
  result: TStepResult,
  expiresAt: string | undefined,
  now: number,
): TStepResult => {
  if (result.status !== "failed") return result
  if (!expiresAt || !isTokenExpired(expiresAt, now)) return result
  return { ...result, error: workloadTokenExpiredMessage(expiresAt) }
}
