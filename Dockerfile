# syntax=docker/dockerfile:1
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
# Registry credential arrives as a BuildKit secret mount, never a build arg/layer.
# The committed .npmrc resolves ${REGISTRY_TOKEN}; export it for this step only.
RUN --mount=type=secret,id=registry-token \
  corepack enable \
  && REGISTRY_TOKEN="$(cat /run/secrets/registry-token)" \
     pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM node:22-slim
WORKDIR /app
LABEL org.opencontainers.image.source=https://github.com/BloomerAB/gittan-runner
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 1001 gittan
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./
USER 1001
CMD ["node", "dist/index.js"]
