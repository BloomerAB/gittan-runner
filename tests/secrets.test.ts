import { describe, expect, it } from "vitest"

import type { TConfig } from "../src/config.js"
import { assembleSecrets, WORKLOAD_REGISTRY_USER } from "../src/pipeline/secrets.js"
import type { TResolvedPipelineMessage } from "../src/pipeline/types.js"

const config: TConfig = {
  natsUrl: "nats://localhost:4222",
  forgejoUrl: "http://localhost:3333",
  registryUrl: "images.gittan.eu",
  registryToken: "static-admin-token",
  registryUser: "gittan-admin",
  workDir: "/tmp/gittan-runner",
}

const message = (
  overrides: Partial<TResolvedPipelineMessage> = {},
): TResolvedPipelineMessage => ({
  pushEventId: "evt-1",
  orgId: "org-1",
  teamId: "team-1",
  repoId: "repo-1",
  branch: "main",
  isGated: true,
  resolved: { steps: [], resolvedFrom: { policies: [], repoConfig: false } },
  ...overrides,
})

describe("assembleSecrets", () => {
  it("prefers the per-run workload token over the static admin token", () => {
    const secrets = assembleSecrets(config, message({ workloadToken: "wl-jwt" }))

    expect(secrets.REGISTRY_TOKEN).toBe("wl-jwt")
    expect(secrets.REGISTRY_USER).toBe(WORKLOAD_REGISTRY_USER)
    expect(secrets.REGISTRY_USER).toBe("gittan-workload")
  })

  it("falls back to the static config token when no workload token is present", () => {
    const secrets = assembleSecrets(config, message())

    expect(secrets.REGISTRY_TOKEN).toBe("static-admin-token")
    expect(secrets.REGISTRY_USER).toBe("gittan-admin")
  })

  it("keeps REGISTRY_URL handling independent of the token source", () => {
    expect(assembleSecrets(config, message({ workloadToken: "wl" })).REGISTRY_URL).toBe(
      "images.gittan.eu",
    )
    expect(assembleSecrets(config, message()).REGISTRY_URL).toBe("images.gittan.eu")
  })

  it("omits registry credentials entirely when neither source provides one", () => {
    const bare: TConfig = { ...config, registryToken: undefined, registryUser: undefined }
    const secrets = assembleSecrets(bare, message())

    expect("REGISTRY_TOKEN" in secrets).toBe(false)
    expect("REGISTRY_USER" in secrets).toBe(false)
  })
})
