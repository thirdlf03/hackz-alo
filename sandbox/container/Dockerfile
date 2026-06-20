FROM docker.io/cloudflare/sandbox:0.12.1

WORKDIR /workspace

ENV TERM=xterm-256color

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends vim \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace/logs /workspace/run /workspace/services /workspace/bin
