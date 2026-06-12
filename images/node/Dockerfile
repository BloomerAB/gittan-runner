FROM node:22-alpine
RUN apk add --no-cache git curl && \
    corepack enable && \
    adduser -D -u 1001 gittan
USER 1001
WORKDIR /workspace
