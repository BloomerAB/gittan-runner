FROM python:3.13-alpine
RUN apk add --no-cache git curl ca-certificates && \
    pip install --no-cache-dir uv && \
    adduser -D -u 1001 gittan
USER 1001
WORKDIR /workspace
