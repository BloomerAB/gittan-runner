import { connect as natsConnect } from "nats"

import { loadConfig } from "./config.js"
import { createDockerStepRunner } from "./pipeline/executor.js"
import { startRunnerSubscriber } from "./pipeline/subscriber.js"

const main = async (): Promise<void> => {
  const config = loadConfig()

  const nats = await natsConnect({ servers: config.natsUrl })
  console.log(`gittan-runner connected to NATS at ${config.natsUrl}`)

  const stepRunner = createDockerStepRunner()

  startRunnerSubscriber({
    nats,
    config,
    stepRunner,
    cloneRepo: async (_forgejoUrl, _repoFullName, _branch, _workDir) => {
      return _workDir
    },
  })

  console.log("gittan-runner listening for pipeline events")

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
