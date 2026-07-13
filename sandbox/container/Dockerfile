FROM docker.io/cloudflare/sandbox:0.12.1

WORKDIR /workspace

ENV TERM=xterm-256color

# vim: エディタ / procps: ps・pgrep・pkill / iproute2: ss / lsof: ポート調査
# jq: JSONログ・statsの調査 / less: ログ閲覧 / curl: 疎通確認
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    vim procps iproute2 lsof jq less curl \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace/logs /workspace/run /workspace/services /workspace/bin /workspace/etc /workspace/releases
