import type { TConfig } from "../config.js"
import type { TResolvedPipelineMessage } from "./types.js"

// The gateway ignores the username (it authorizes on the token alone), but npm
// and docker login both require a non-empty user, so we send a stable label.
export const WORKLOAD_REGISTRY_USER = "gittan-workload"

// Prefer the per-run workload token over the shared admin token. Static config
// credentials are only a fallback for messages minted before component A
// shipped (migration tolerance) — once every API emits a workloadToken this
// branch is dead.
export const assembleSecrets = (
  config: TConfig,
  message: TResolvedPipelineMessage,
): Record<string, string> => {
  const secrets: Record<string, string> = {}
  if (config.npmToken) secrets.NPM_TOKEN = config.npmToken
  if (config.registryUrl) secrets.REGISTRY_URL = config.registryUrl

  if (message.workloadToken) {
    secrets.REGISTRY_TOKEN = message.workloadToken
    secrets.REGISTRY_USER = WORKLOAD_REGISTRY_USER
  } else {
    if (config.registryToken) secrets.REGISTRY_TOKEN = config.registryToken
    if (config.registryUser) secrets.REGISTRY_USER = config.registryUser
  }

  return secrets
}
