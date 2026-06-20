FROM node:24-slim

WORKDIR /workspace
COPY server.mjs /opt/incident-sandbox/server.mjs

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl procps \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /workspace /opt/incident-sandbox

EXPOSE 3000
CMD ["node", "/opt/incident-sandbox/server.mjs"]
