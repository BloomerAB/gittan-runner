import { z } from "zod"

const ConfigSchema = z.object({
  natsUrl: z.string().default("nats://localhost:4222"),
  forgejoUrl: z.string().url().default("http://localhost:3333"),
  forgejoToken: z.string().min(1).optional(),
  npmToken: z.string().min(1).optional(),
  registryUrl: z.string().min(1).optional(),
  registryToken: z.string().min(1).optional(),
  registryUser: z.string().min(1).optional(),
  workDir: z.string().default("/tmp/gittan-runner"),
})

export type TConfig = z.infer<typeof ConfigSchema>

const env = (key: string): string | undefined => {
  const value = process.env[key]
  return value === "" || value === undefined ? undefined : value
}

export const loadConfig = (): TConfig => {
  const result = ConfigSchema.safeParse({
    natsUrl: env("NATS_URL"),
    forgejoUrl: env("FORGEJO_URL"),
    forgejoToken: env("FORGEJO_TOKEN"),
    npmToken: env("NPM_TOKEN"),
    registryUrl: env("REGISTRY_URL"),
    registryToken: env("REGISTRY_TOKEN"),
    registryUser: env("REGISTRY_USER"),
    workDir: env("WORK_DIR"),
  })

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid configuration:\n${errors}`)
  }

  return result.data
}
