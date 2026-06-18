FROM node:22-slim AS builder
WORKDIR /app
ARG NPM_TOKEN
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable \
  && echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc \
  && pnpm install --frozen-lockfile \
  && rm -f .npmrc
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN useradd -r -u 1001 gittan
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./
USER 1001
CMD ["node", "dist/index.js"]
