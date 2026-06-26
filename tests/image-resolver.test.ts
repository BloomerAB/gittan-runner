import { describe, expect, it } from "vitest"

import { resolveImage } from "../src/pipeline/image-resolver.js"

describe("resolveImage", () => {
  it("resolves vetted gittan images to pinned digests", () => {
    const result = resolveImage("gittan/node:22")
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.resolved).toContain("node:22-alpine@sha256:")
      expect(result.source).toBe("vetted")
    }
  })

  it("rejects unknown gittan images", () => {
    const result = resolveImage("gittan/ruby:3.3")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain("Unknown vetted image")
    }
  })

  it("rejects :latest tags", () => {
    const result = resolveImage("node:latest")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain("Floating tag rejected")
    }
  })

  it("rejects images with no tag (implicit :latest)", () => {
    const result = resolveImage("node")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain("No tag specified")
    }
  })

  it("rejects unpinned external images", () => {
    const result = resolveImage("node:22-alpine")
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain("Unpinned external image")
    }
  })

  it("accepts external images pinned by digest", () => {
    const ref = "node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2"
    const result = resolveImage(ref)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.resolved).toBe(ref)
      expect(result.source).toBe("pinned")
    }
  })
})
