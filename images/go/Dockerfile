FROM golang:1.24-alpine
RUN apk add --no-cache git curl ca-certificates gcc musl-dev && \
    adduser -D -u 1001 gittan
USER 1001
WORKDIR /workspace
ENV GOPATH=/home/gittan/go
ENV PATH=$PATH:/home/gittan/go/bin
