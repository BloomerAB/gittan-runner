import { describe, expect, it } from "vitest"

import type { TResolvedStep } from "../src/pipeline/types.js"
import {
  annotateExpiredError,
  expiredStepResult,
  isTokenExpired,
  workloadTokenExpiredMessage,
} from "../src/pipeline/workload-token.js"

const EXPIRES_AT = "2026-06-30T12:00:00.000Z"
const EXPECTED_MESSAGE = `Workload token expired at ${EXPIRES_AT} — this pipeline run exceeded the 30-minute token lifetime. This is a token-TTL limit, not a build/code failure.`

const publishStep: TResolvedStep = {
  name: "publish",
  description: "publish image",
  publish: { image: "app", dockerfile: "Dockerfile" },
  timeout: "10m",
  source: "repo",
}

describe("isTokenExpired", () => {
  it("is true once now reaches the expiry instant", () => {
    expect(isTokenExpired(EXPIRES_AT, Date.parse(EXPIRES_AT))).toBe(true)
    expect(isTokenExpired(EXPIRES_AT, Date.parse(EXPIRES_AT) + 1)).toBe(true)
  })

  it("is false before expiry", () => {
    expect(isTokenExpired(EXPIRES_AT, Date.parse(EXPIRES_AT) - 1)).toBe(false)
  })

  it("is false when no expiry is provided (migration tolerance)", () => {
    expect(isTokenExpired(undefined, Date.now())).toBe(false)
  })

  it("is false for an unparseable expiry rather than failing closed unexpectedly", () => {
    expect(isTokenExpired("not-a-date", Date.now())).toBe(false)
  })
})

describe("workloadTokenExpiredMessage", () => {
  it("renders the exact unambiguous TTL message", () => {
    expect(workloadTokenExpiredMessage(EXPIRES_AT)).toBe(EXPECTED_MESSAGE)
  })
})

describe("expiredStepResult (pre-check decision)", () => {
  it("fails the step with the exact message and marks it as never executed", () => {
    const result = expiredStepResult(publishStep, EXPIRES_AT)

    expect(result.status).toBe("failed")
    expect(result.error).toBe(EXPECTED_MESSAGE)
    expect(result.exitCode).toBe(1)
    // durationMs 0 is the signal the step was refused, not run.
    expect(result.durationMs).toBe(0)
    expect(result.stepName).toBe("publish")
    expect(result.source).toBe("repo")
  })
})

describe("annotateExpiredError (post-failure annotation)", () => {
  const failed = {
    stepName: "publish",
    status: "failed" as const,
    durationMs: 1234,
    exitCode: 1,
    error: "401 Unauthorized from images.gittan.eu",
    source: "repo" as const,
  }

  it("appends the TTL message to the real error when expired (preserves diagnostic)", () => {
    const annotated = annotateExpiredError(failed, EXPIRES_AT, Date.parse(EXPIRES_AT) + 1)

    expect(annotated.error).toBe(`401 Unauthorized from images.gittan.eu\n\n${EXPECTED_MESSAGE}`)
    expect(annotated.error).toContain("401 Unauthorized from images.gittan.eu")
    expect(annotated.durationMs).toBe(1234)
  })

  it("leaves the error untouched when the token has not expired", () => {
    const annotated = annotateExpiredError(failed, EXPIRES_AT, Date.parse(EXPIRES_AT) - 1)
    expect(annotated.error).toBe("401 Unauthorized from images.gittan.eu")
  })

  it("leaves passing steps untouched even past expiry", () => {
    const passed = { ...failed, status: "passed" as const, error: undefined }
    const annotated = annotateExpiredError(passed, EXPIRES_AT, Date.parse(EXPIRES_AT) + 1)
    expect(annotated).toEqual(passed)
  })

  it("is a no-op when no expiry is provided", () => {
    expect(annotateExpiredError(failed, undefined, Date.now())).toBe(failed)
  })
})
