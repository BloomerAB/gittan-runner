FROM docker:27-cli
RUN apk add --no-cache git curl ca-certificates && \
    adduser -D -u 1001 gittan
USER 1001
WORKDIR /workspace
