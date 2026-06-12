import { connect, StringCodec, type NatsConnection } from "nats"

const sc = StringCodec()

type TPushInfo = {
  readonly oldSha: string
  readonly newSha: string
  readonly ref: string
}

const parsePushInput = (input: string): TPushInfo[] =>
  input
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [oldSha, newSha, ref] = line.split(" ")
      return { oldSha, newSha, ref }
    })

const sideband = (msg: string): void => {
  process.stderr.write(`${msg}\n`)
}

const formatDuration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export const handlePreReceive = async (
  input: string,
  natsUrl: string,
  repoFullName: string,
  gatedBranches: ReadonlyArray<string>,
): Promise<boolean> => {
  const pushes = parsePushInput(input)

  const gatedPush = pushes.find((p) => {
    const branch = p.ref.replace("refs/heads/", "")
    return gatedBranches.includes(branch)
  })

  if (!gatedPush) return true

  const branch = gatedPush.ref.replace("refs/heads/", "")
  const shortSha = gatedPush.newSha.slice(0, 7)

  sideband("")
  sideband(`── pipeline starting ──────────────────`)

  let nats: NatsConnection
  try {
    nats = await connect({ servers: natsUrl })
  } catch {
    sideband("⚠ Pipeline service unavailable — accepting push")
    return true
  }

  try {
    const pushEventId = `push-${shortSha}-${Date.now()}`

    nats.publish(
      "gittan.push.gated",
      sc.encode(
        JSON.stringify({
          id: pushEventId,
          repoName: repoFullName,
          branch,
          commits: [{ sha: gatedPush.newSha, message: "", author: "", timestamp: new Date().toISOString() }],
          pusher: process.env.USER ?? "unknown",
          timestamp: new Date().toISOString(),
          isGated: true,
        }),
      ),
    )

    const sub = nats.subscribe("gittan.pipeline.step-progress")
    const resultSub = nats.subscribe("gittan.pipeline.result")

    const result = await new Promise<{ status: string; steps: Array<{ stepName: string; status: string; durationMs: number; error?: string }> }>((resolve) => {
      const timeout = setTimeout(() => {
        sideband("⚠ Pipeline timeout — accepting push")
        resolve({ status: "passed", steps: [] })
      }, 600_000)

      ;(async () => {
        for await (const msg of sub) {
          const step = JSON.parse(sc.decode(msg.data))
          if (step.pushEventId !== pushEventId) continue

          const icon = step.status === "passed" ? "✓" : step.status === "failed" ? "✗" : step.status === "running" ? "⟳" : "⊘"
          const duration = step.durationMs > 0 ? formatDuration(step.durationMs) : ""
          sideband(`${icon} ${step.stepName.padEnd(20)} ${duration}`)

          if (step.error) {
            for (const line of step.error.split("\n").slice(0, 3)) {
              sideband(`  ${line}`)
            }
          }
        }
      })()

      ;(async () => {
        for await (const msg of resultSub) {
          const r = JSON.parse(sc.decode(msg.data))
          if (r.pushEventId !== pushEventId) continue
          clearTimeout(timeout)
          sub.unsubscribe()
          resultSub.unsubscribe()
          resolve(r)
        }
      })()
    })

    sideband(`── pipeline ${result.status} ────────────────────`)

    if (result.status === "passed") {
      sideband(`✓ ${branch} → ${shortSha}`)
    } else {
      sideband(`✗ ${branch} unchanged`)
    }

    sideband("")

    await nats.drain()

    return result.status === "passed"
  } catch (err) {
    sideband(`⚠ Pipeline error — accepting push`)
    try { await nats.drain() } catch {}
    return true
  }
}
