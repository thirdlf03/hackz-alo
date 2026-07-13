#!/usr/bin/env node
// 監視エージェント。数秒おきに実測 CPU/メモリを
// /workspace/run/metrics/agent.json に timestamp 付きで書き続ける常駐プロセス。
// 起動時に /workspace/etc/monitoring.json を {"source":"agent"} にするので、
// これ以降 metrics/collector.mjs はこのファイルを読みに行く。
// このプロセスを kill すると agent.json の timestamp が古くなり、
// メトリクスが欠測(null)になる(monitor_blind の実体)。
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCpuPercent, readMemoryPercent} from '../metrics/collector.mjs';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const SAMPLE_INTERVAL_MS = 3000;

export function agentFilePath(workspace = DEFAULT_WORKSPACE) {
  return path.join(workspace, 'run', 'metrics', 'agent.json');
}

export function monitoringConfigPath(workspace = DEFAULT_WORKSPACE) {
  return path.join(workspace, 'etc', 'monitoring.json');
}

export async function sampleOnce(workspace = DEFAULT_WORKSPACE) {
  const [cpu, memory] = await Promise.all([
    readCpuPercent(),
    readMemoryPercent(),
  ]);
  await mkdir(path.dirname(agentFilePath(workspace)), {recursive: true});
  await writeFile(
    agentFilePath(workspace),
    JSON.stringify({cpu, memory, at: Date.now()})
  );
  return {cpu, memory};
}

export async function startMonitorAgent(workspace = DEFAULT_WORKSPACE) {
  await mkdir(path.dirname(monitoringConfigPath(workspace)), {
    recursive: true,
  });
  await writeFile(
    monitoringConfigPath(workspace),
    `${JSON.stringify({source: 'agent'})}\n`
  );
  await sampleOnce(workspace);
  const timer = setInterval(() => {
    sampleOnce(workspace).catch(() => {
      // a transient read failure should not crash the agent; the next
      // tick will retry, and a prolonged failure shows up as stale data
    });
  }, SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await startMonitorAgent(DEFAULT_WORKSPACE);
}
