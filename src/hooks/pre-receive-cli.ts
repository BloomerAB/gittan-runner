#!/usr/bin/env node

import { readFileSync } from "node:fs"

import { handlePreReceive } from "./pre-receive.js"

const main = async (): Promise<void> => {
  const input = readFileSync("/dev/stdin", "utf-8")

  const natsUrl = process.env.NATS_URL ?? "nats://localhost:4222"
  const repoFullName = process.env.GL_REPOSITORY ?? process.env.GITEA_REPO_NAME ?? "unknown"
  const gatedBranches = (process.env.GITTAN_GATED_BRANCHES ?? "main").split(",")

  const accepted = await handlePreReceive(input, natsUrl, repoFullName, gatedBranches)

  process.exit(accepted ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`\nPre-receive hook error: ${err}\n`)
  process.exit(0)
})
