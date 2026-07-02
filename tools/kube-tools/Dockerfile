# kube-tools: kubeconform + kyverno CLI + kustomize on Alpine, with /bin/sh.
# Multi-stage: fetch + checksum-verify pinned release binaries in a builder,
# ship only the binaries + CA certs in the final image.

# --- builder: download and verify pinned binaries ---
FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d AS builder

RUN apk add --no-cache curl tar

WORKDIR /out

# kubeconform v0.8.0
RUN curl -fsSL -o kubeconform.tar.gz \
      https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz && \
    echo "9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883  kubeconform.tar.gz" | sha256sum -c - && \
    tar -xzf kubeconform.tar.gz kubeconform && \
    rm kubeconform.tar.gz

# kyverno CLI v1.18.1 (archive contains the `kyverno` binary)
RUN curl -fsSL -o kyverno.tar.gz \
      https://github.com/kyverno/kyverno/releases/download/v1.18.1/kyverno-cli_v1.18.1_linux_x86_64.tar.gz && \
    echo "5e6bba9ca85beec6c93e94ca7fb0972a66df3b2e67636a08bef090cd3fc6535c  kyverno.tar.gz" | sha256sum -c - && \
    tar -xzf kyverno.tar.gz kyverno && \
    rm kyverno.tar.gz

# kustomize v5.8.1
RUN curl -fsSL -o kustomize.tar.gz \
      "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv5.8.1/kustomize_v5.8.1_linux_amd64.tar.gz" && \
    echo "029a7f0f4e1932c52a0476cf02a0fd855c0bb85694b82c338fc648dcb53a819d  kustomize.tar.gz" | sha256sum -c - && \
    tar -xzf kustomize.tar.gz kustomize && \
    rm kustomize.tar.gz

RUN chmod +x /out/kubeconform /out/kyverno /out/kustomize

# --- final image ---
FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d

# TLS roots for any registry/schema fetches kubeconform may do at runtime.
RUN apk add --no-cache ca-certificates

COPY --from=builder /out/kubeconform /usr/local/bin/kubeconform
COPY --from=builder /out/kyverno /usr/local/bin/kyverno
COPY --from=builder /out/kustomize /usr/local/bin/kustomize

# Smoke-test that all three binaries run in this image (fails the build if not).
RUN kubeconform -v && kyverno version && kustomize version
