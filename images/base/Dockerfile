FROM alpine:3.22
RUN apk add --no-cache git curl ca-certificates && \
    adduser -D -u 1001 gittan
USER 1001
WORKDIR /workspace
