import { describe, expect, it } from "vitest"

import { runStaticReview, formatReviewOutput } from "../src/steps/ai-review.js"

describe("ai-review tooling rules", () => {
  it("flags Redis in package.json", () => {
    const result = runStaticReview(
      [{ path: "package.json", content: '{ "dependencies": { "redis": "^4.0.0" } }' }],
      ["tooling"],
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].message).toContain("Redis")
    expect(result.findings[0].suggestion).toContain("NATS")
  })

  it("flags moment.js", () => {
    const result = runStaticReview(
      [{ path: "package.json", content: '{ "dependencies": { "moment": "^2.30.0" } }' }],
      ["tooling"],
    )
    expect(result.findings[0].message).toContain("deprecated")
  })

  it("flags full lodash import", () => {
    const result = runStaticReview(
      [{ path: "src/utils.ts", content: 'import _ from "lodash"' }],
      ["tooling"],
    )
    expect(result.findings[0].message).toContain("lodash")
  })

  it("flags ubuntu base image", () => {
    const result = runStaticReview(
      [{ path: "Dockerfile", content: "FROM ubuntu:24.04\nRUN apt-get update" }],
      ["tooling"],
    )
    expect(result.findings[0].message).toContain("Ubuntu")
    expect(result.findings[0].suggestion).toContain("Alpine")
  })

  it("flags latest tag in Dockerfile", () => {
    const result = runStaticReview(
      [{ path: "Dockerfile", content: "FROM node:latest" }],
      ["tooling"],
    )
    expect(result.findings[0].message).toContain("latest")
  })

  it("flags console.log in production code", () => {
    const result = runStaticReview(
      [{ path: "src/server.ts", content: 'console.log("starting server")' }],
      ["tooling"],
    )
    expect(result.findings[0].message).toContain("Console.log")
  })

  it("passes clean code", () => {
    const result = runStaticReview(
      [{ path: "src/index.ts", content: 'import { createServer } from "./server.js"' }],
      ["tooling"],
    )
    expect(result.findings).toHaveLength(0)
    expect(result.passed).toBe(true)
  })
})

describe("ai-review security rules", () => {
  it("flags eval", () => {
    const result = runStaticReview(
      [{ path: "src/api.ts", content: "eval(userInput)" }],
      ["security"],
    )
    expect(result.findings[0].severity).toBe("critical")
    expect(result.findings[0].message).toContain("eval")
  })

  it("flags innerHTML", () => {
    const result = runStaticReview(
      [{ path: "src/App.tsx", content: "el.innerHTML = data" }],
      ["security"],
    )
    expect(result.findings[0].severity).toBe("critical")
  })

  it("flags privileged containers", () => {
    const result = runStaticReview(
      [{ path: "deploy.yaml", content: "privileged: true" }],
      ["security"],
    )
    expect(result.findings[0].severity).toBe("critical")
  })

  it("fails on critical findings", () => {
    const result = runStaticReview(
      [{ path: "src/api.ts", content: "eval(userInput)" }],
      ["security"],
    )
    expect(result.passed).toBe(false)
  })
})

describe("formatReviewOutput", () => {
  it("formats clean result", () => {
    const output = formatReviewOutput({ summary: "No issues", findings: [], passed: true })
    expect(output).toContain("✓ No issues found")
  })

  it("formats findings with severity icons", () => {
    const output = formatReviewOutput({
      summary: "2 findings",
      passed: false,
      findings: [
        { severity: "critical", category: "security", file: "src/api.ts", line: 42, message: "eval() detected" },
        { severity: "warning", category: "tooling", file: "package.json", line: 5, message: "Redis detected", suggestion: "Use NATS" },
      ],
    })
    expect(output).toContain("✗ src/api.ts:42")
    expect(output).toContain("⚠ package.json:5")
    expect(output).toContain("→ Use NATS")
  })
})
