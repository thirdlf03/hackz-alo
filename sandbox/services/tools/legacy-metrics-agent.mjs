#!/usr/bin/env node
// 撤去し忘れた旧監視エージェント。再起動すると設定済みのポート(既定8080)を
// 先取りしてしまい、やまびこ API が起動できなくなる。
// ss -ltnp / lsof -i で特定して kill するのが正しい対処。
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function createLegacyMetricsAgent() {
  return http.createServer((req, res) => {
    res.writeHead(503, {'content-type': 'application/json; charset=utf-8'});
    res.end(
      JSON.stringify({
        service: 'legacy-metrics-agent',
        error: 'no scrape targets configured',
        hint: 'this agent was scheduled for decommission in 2019',
      })
    );
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const port = Number(process.env.PORT ?? 8080);
  createLegacyMetricsAgent().listen(port, () => {
    console.log(`legacy-metrics-agent listening on ${port}`);
  });
}
