#!/usr/bin/env node
// 撤去し忘れたノイズアラート発生源。定期的に偽の CRITICAL/WARN 行を
// /workspace/logs/app.log に書き続ける。本物の障害がこのノイズに埋もれる。
// pgrep -f alert-flood-daemon.mjs で特定し、pkill -f alert-flood-daemon.mjs で止める。
import {appendFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const INTERVAL_MS = 4000;

const NOISE_ALERTS = [
  {severity: 'CRITICAL', message: 'CPU fan is dancing'},
  {severity: 'WARN', message: 'Energy drink stock critically low'},
  {severity: 'WARN', message: 'Janitor camera lens fogged'},
  {severity: 'CRITICAL', message: 'Fridge door open for 3 minutes'},
];

export async function floodOnce(workspace, count, tick = 0) {
  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  const lines = Array.from({length: count}, (_, index) => {
    const item = NOISE_ALERTS[(tick + index) % NOISE_ALERTS.length];
    return `noise alert: [${item.severity}] ${item.message}\n`;
  }).join('');
  await appendFile(path.join(workspace, 'logs', 'app.log'), lines);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const workspace = DEFAULT_WORKSPACE;
  const count = Math.max(1, Number(process.argv[2] ?? 4));
  let tick = 0;
  const run = async () => {
    await floodOnce(workspace, count, tick).catch(() => {});
    tick += 1;
  };
  await run();
  setInterval(run, INTERVAL_MS);
}
