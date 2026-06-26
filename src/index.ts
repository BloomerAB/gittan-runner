import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"

import { connect as natsConnect } from "nats"

import { loadConfig } from "./config.js"
import { startRunnerSubscriber } from "./pipeline/subscriber.js"

const cloneRepo = async (
  forgejoUrl: string,
  repoFullName: string,
  branch: string,
  workDir: string,
): Promise<string> => {
  const cloneUrl = `${forgejoUrl}/${repoFullName}.git`
  await mkdir(workDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["clone", "--depth", "1", "--branch", branch, cloneUrl, workDir],
      { timeout: 60_000 },
      (error) => {
        if (error) reject(new Error(`git clone failed: ${error.message}`))
        else resolve()
      },
    )
  })

  return workDir
}

const main = async (): Promise<void> => {
  const config = loadConfig()

  const nats = await natsConnect({ servers: config.natsUrl })
  console.log(`gittan-runner connected to NATS at ${config.natsUrl}`)

  startRunnerSubscriber({
    nats,
    config,
    cloneRepo,
  })

  console.log("gittan-runner listening for pipeline events (dagger executor)")

  const shutdown = async (): Promise<void> => {
    console.log("Shutting down...")
    await nats.drain()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((err) => {
  console.error("Failed to start:", err)
  process.exit(1)
})
