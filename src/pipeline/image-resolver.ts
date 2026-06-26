const VETTED_IMAGES: Record<string, string> = {
  "gittan/node:22": "node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2",
} as const

type TImageValidation =
  | { readonly valid: true; readonly resolved: string; readonly source: "vetted" | "pinned" }
  | { readonly valid: false; readonly reason: string }

const DIGEST_RE = /@sha256:[a-f0-9]{64}$/
const FLOATING_TAG_RE = /:latest$/

export const resolveImage = (ref: string): TImageValidation => {
  if (ref in VETTED_IMAGES) {
    return { valid: true, resolved: VETTED_IMAGES[ref], source: "vetted" }
  }

  if (FLOATING_TAG_RE.test(ref)) {
    return { valid: false, reason: `Floating tag rejected: "${ref}" — pin by digest (@sha256:...)` }
  }

  if (!ref.includes(":")) {
    return { valid: false, reason: `No tag specified: "${ref}" — implicit :latest is not allowed` }
  }

  if (ref.startsWith("gittan/")) {
    return { valid: false, reason: `Unknown vetted image: "${ref}" — not in the approved registry` }
  }

  if (DIGEST_RE.test(ref)) {
    return { valid: true, resolved: ref, source: "pinned" }
  }

  return {
    valid: false,
    reason: `Unpinned external image: "${ref}" — off-road images must be pinned by digest (@sha256:...)`,
  }
}
