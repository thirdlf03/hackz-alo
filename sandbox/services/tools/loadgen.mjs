#!/usr/bin/env node
// 何かのバッチが暴走し、やまびこ API に高頻度リクエストを送り続けている。
// API を落とすほどではないが、RPS/レイテンシに明らかな異常として現れる。
// pgrep -f loadgen.mjs で特定し、pkill -f loadgen.mjs で止めるのが正しい対処。
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_TARGET_URL = 'http://127.0.0.1:8080/orders';
const INTERVAL_MS = 50;
const REQUEST_TIMEOUT_MS = 2000;

export async function runLoadgen({
  targetUrl = DEFAULT_TARGET_URL,
  intervalMs = INTERVAL_MS,
  signal,
} = {}) {
  while (!signal?.aborted) {
    fetch(targetUrl, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)}).catch(
      () => {}
    );
    await delay(intervalMs);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const targetUrl = process.argv[2] ?? DEFAULT_TARGET_URL;
  await runLoadgen({targetUrl});
}
