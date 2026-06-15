export type TReviewFocus = "architecture" | "security" | "changes" | "tooling"

export type TReviewFinding = {
  readonly severity: "critical" | "warning" | "info"
  readonly category: TReviewFocus
  readonly file?: string
  readonly line?: number
  readonly message: string
  readonly suggestion?: string
  readonly opsImpact?: string
}

export type TReviewResult = {
  readonly summary: string
  readonly findings: ReadonlyArray<TReviewFinding>
  readonly passed: boolean
}

const TOOLING_RULES: ReadonlyArray<{
  pattern: RegExp
  file: RegExp
  message: string
  suggestion: string
}> = [
  {
    pattern: /["']redis["']|["']ioredis["']|from\s+["']redis/,
    file: /package\.json|\.ts$|\.js$/,
    message: "Redis detected. Redis is often chosen by default rather than by evaluation. It adds operational complexity that simpler alternatives avoid.",
    suggestion: "For pub/sub → NATS. For caching → database built-in cache, Varnish, or CDN. For sessions → primary database. For queues → NATS JetStream. For dedicated cache → KeyDB or DragonflyDB (drop-in, better performance).",
    opsImpact: "Redis requires: memory capacity planning (OOM kills), persistence config (RDB vs AOF trade-offs), cluster mode for HA (adds 6+ nodes), monitoring for memory fragmentation, and manual failover testing. Each of these is a production incident waiting to happen.",
  },
  {
    pattern: /["']mongoose["']|require\(["']mongoose/,
    file: /package\.json|\.ts$|\.js$/,
    message: "Mongoose adds an abstraction layer that hides MongoDB's query language. This makes simple things easy but complex things harder to debug.",
    suggestion: "Consider the native MongoDB driver for full control, or evaluate if MongoDB is the right choice — SQLite for single-node simplicity, ScyllaDB for distributed workloads.",
  },
  {
    pattern: /["']express["'].*["']4\./,
    file: /package\.json$/,
    message: "Express 4 is legacy. Express 5 has been stable since 2024.",
    suggestion: "Upgrade to Express 5 for async error handling and modern routing.",
  },
  {
    pattern: /["']moment["']|require\(["']moment/,
    file: /package\.json|\.ts$|\.js$/,
    message: "Moment.js is deprecated and massive (300KB+).",
    suggestion: "Use native Date, Temporal (stage 3), or date-fns if you need formatting.",
  },
  {
    pattern: /["']lodash["']|require\(["']lodash["']\)/,
    file: /package\.json|\.ts$|\.js$/,
    message: "Full lodash import. Most lodash utilities exist natively in modern JavaScript.",
    suggestion: "Use native Array/Object methods, or import specific functions: lodash.get instead of lodash.",
  },
  {
    pattern: /["']sequelize["']|["']typeorm["']|["']prisma/,
    file: /package\.json$/,
    message: "ORM detected. ORMs add abstraction that makes simple queries easy but complex queries painful, and hide performance characteristics.",
    suggestion: "Consider using your database driver directly with prepared statements. You'll understand your queries, debug faster, and avoid the ORM's limitations becoming your limitations.",
  },
  {
    pattern: /latest/,
    file: /Dockerfile$|docker-compose/,
    message: "':latest' tag used in container image.",
    suggestion: "Pin to a specific version. latest is unpredictable and breaks reproducibility.",
  },
  {
    pattern: /FROM\s+ubuntu|FROM\s+debian/,
    file: /Dockerfile$/,
    message: "Ubuntu/Debian base image is unnecessarily large.",
    suggestion: "Use Alpine or distroless. Your image will be 10x smaller and have fewer vulnerabilities.",
  },
  {
    pattern: /console\.log\(|console\.error\(/,
    file: /\.ts$|\.js$/,
    message: "Console.log in production code.",
    suggestion: "Use a structured logger (pino, structlog) for production. Console.log is for debugging.",
  },
  {
    pattern: /process\.env\.\w+/,
    file: /(?<!config)\.ts$|(?<!config)\.js$/,
    message: "Direct process.env access outside config module.",
    suggestion: "Centralize env var access in a config module with validation (Zod, pydantic).",
  },
]

const SECURITY_RULES: ReadonlyArray<{
  pattern: RegExp
  file: RegExp
  message: string
  severity: "critical" | "warning"
}> = [
  {
    pattern: /["'][A-Za-z0-9+/]{40,}["']/,
    file: /\.ts$|\.js$|\.py$/,
    message: "Possible hardcoded secret or API key detected.",
    severity: "critical",
  },
  {
    pattern: /eval\(|new Function\(/,
    file: /\.ts$|\.js$/,
    message: "eval() or new Function() — code injection risk.",
    severity: "critical",
  },
  {
    pattern: /innerHTML\s*=/,
    file: /\.tsx?$|\.jsx?$/,
    message: "innerHTML assignment — XSS risk.",
    severity: "critical",
  },
  {
    pattern: /`.*\$\{.*\}.*`.*query|execute.*`.*\$\{/,
    file: /\.ts$|\.js$/,
    message: "String interpolation in database query — SQL injection risk.",
    severity: "critical",
  },
  {
    pattern: /password.*=.*["'][^"']+["']/i,
    file: /\.ts$|\.js$|\.py$|\.yaml$|\.yml$/,
    message: "Possible hardcoded password.",
    severity: "critical",
  },
  {
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/,
    file: /\.ts$|\.js$|\.py$/,
    message: "HTTP (not HTTPS) URL to external service.",
    severity: "warning",
  },
  {
    pattern: /allowPrivilegeEscalation:\s*true|privileged:\s*true/,
    file: /\.yaml$|\.yml$/,
    message: "Privileged container or privilege escalation enabled.",
    severity: "critical",
  },
  {
    pattern: /runAsRoot|runAsUser:\s*0/,
    file: /\.yaml$|\.yml$/,
    message: "Container running as root.",
    severity: "warning",
  },
]

export const runStaticReview = (
  files: ReadonlyArray<{ path: string; content: string }>,
  focus: ReadonlyArray<TReviewFocus>,
): TReviewResult => {
  const findings: TReviewFinding[] = []

  for (const file of files) {
    const lines = file.content.split("\n")

    if (focus.includes("tooling")) {
      for (const rule of TOOLING_RULES) {
        if (!rule.file.test(file.path)) continue

        for (let i = 0; i < lines.length; i++) {
          if (rule.pattern.test(lines[i])) {
            findings.push({
              severity: "warning",
              category: "tooling",
              file: file.path,
              line: i + 1,
              message: rule.message,
              suggestion: rule.suggestion,
              opsImpact: (rule as { opsImpact?: string }).opsImpact,
            })
            break
          }
        }
      }
    }

    if (focus.includes("security")) {
      for (const rule of SECURITY_RULES) {
        if (!rule.file.test(file.path)) continue

        for (let i = 0; i < lines.length; i++) {
          if (rule.pattern.test(lines[i])) {
            findings.push({
              severity: rule.severity,
              category: "security",
              file: file.path,
              line: i + 1,
              message: rule.message,
            })
          }
        }
      }
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical")
  const warningCount = findings.filter((f) => f.severity === "warning").length

  return {
    summary: hasCritical
      ? `${findings.length} findings (${findings.filter((f) => f.severity === "critical").length} critical)`
      : warningCount > 0
        ? `${warningCount} warnings`
        : "No issues found",
    findings,
    passed: !hasCritical,
  }
}

export const formatReviewOutput = (result: TReviewResult): string => {
  const lines: string[] = []

  if (result.findings.length === 0) {
    lines.push("✓ No issues found")
    return lines.join("\n")
  }

  const grouped = new Map<TReviewFocus, TReviewFinding[]>()
  for (const f of result.findings) {
    const existing = grouped.get(f.category) ?? []
    grouped.set(f.category, [...existing, f])
  }

  for (const [category, categoryFindings] of grouped) {
    lines.push(`\n${category.toUpperCase()}:`)

    for (const f of categoryFindings) {
      const icon = f.severity === "critical" ? "✗" : f.severity === "warning" ? "⚠" : "ℹ"
      const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : ""
      lines.push(`  ${icon} ${location}`)
      lines.push(`    ${f.message}`)
      if (f.suggestion) {
        lines.push(`    → ${f.suggestion}`)
      }
      if (f.opsImpact) {
        lines.push(`    ⚙ Ops impact: ${f.opsImpact}`)
      }
    }
  }

  lines.push(`\n${result.summary}`)

  return lines.join("\n")
}
