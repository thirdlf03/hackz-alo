import {execFile} from 'node:child_process';
import {appendFile, mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {readApiConfig} from '../yamabiko-api/config.mjs';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 1500;

const DEFAULT_TRAFFIC_WINDOW_MS = 60_000;

let lastCpuSample = undefined;

function trafficSamplesPath(workspace) {
  return path.join(workspace, 'run', 'traffic-samples.jsonl');
}

export function snapshotTrafficSamples(
  samples,
  windowMs = DEFAULT_TRAFFIC_WINDOW_MS
) {
  const total = samples.length;
  if (total === 0) {
    return {http5xxRate: 0, latencyP95Ms: 0, rps: 0};
  }

  const errors = samples.filter((sample) => sample.status >= 500).length;
  const durations = samples
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);

  return {
    http5xxRate: errors / total,
    latencyP95Ms: durations[p95Index] ?? 0,
    rps: Math.round(total / (windowMs / 1000)),
  };
}

export async function readTrafficSamples(
  workspace,
  windowMs = DEFAULT_TRAFFIC_WINDOW_MS
) {
  const samplesPath = trafficSamplesPath(workspace);
  if (!existsSync(samplesPath)) return [];

  try {
    const content = await readFile(samplesPath, 'utf8');
    const cutoff = Date.now() - windowMs;
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((sample) => Number.isFinite(sample.at) && sample.at >= cutoff);
  } catch {
    return [];
  }
}

async function rewriteTrafficSamples(workspace, samples) {
  await mkdir(path.join(workspace, 'run'), {recursive: true});
  const content =
    samples.length > 0
      ? `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`
      : '';
  await writeFile(trafficSamplesPath(workspace), content);
}

export async function appendTrafficSample(
  workspace,
  status,
  durationMs,
  at = Date.now()
) {
  await mkdir(path.join(workspace, 'run'), {recursive: true});
  await appendFile(
    trafficSamplesPath(workspace),
    `${JSON.stringify({at, status, durationMs})}\n`
  );
}

export async function pruneTrafficSamples(
  workspace,
  windowMs = DEFAULT_TRAFFIC_WINDOW_MS
) {
  const samples = await readTrafficSamples(workspace, windowMs);
  await rewriteTrafficSamples(workspace, samples);
  return samples;
}

export async function probeUpstreamTraffic(
  workspace,
  baseUrl = 'http://127.0.0.1:8080'
) {
  for (const pathname of ['/health', '/orders']) {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await appendTrafficSample(
        workspace,
        response.status,
        Math.round(performance.now() - startedAt)
      );
    } catch {
      await appendTrafficSample(
        workspace,
        500,
        Math.round(performance.now() - startedAt)
      );
    }
  }
}

export async function readTrafficMetrics(
  workspace,
  windowMs = DEFAULT_TRAFFIC_WINDOW_MS,
  options = {}
) {
  const probe = options.probe ?? true;
  if (probe) await probeUpstreamTraffic(workspace);
  const samples = await pruneTrafficSamples(workspace, windowMs);
  return snapshotTrafficSamples(samples, windowMs);
}

export class RequestMetricsTracker {
  constructor(windowMs = DEFAULT_TRAFFIC_WINDOW_MS) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  record(status, durationMs) {
    const at = Date.now();
    this.samples.push({at, status, durationMs});
    this.prune(at);
  }

  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((sample) => sample.at >= cutoff);
  }

  snapshot() {
    this.prune();
    return snapshotTrafficSamples(this.samples, this.windowMs);
  }
}

const AGENT_STALE_AFTER_MS = 10_000;

export async function readSystemMetrics(workspace = '/workspace') {
  const monitoring = await readMonitoringConfig(workspace);
  const disk = await readDiskPercent(workspace);

  if (monitoring.source === 'agent') {
    const agentMetrics = await readAgentMetrics(workspace);
    return {cpu: agentMetrics.cpu, memory: agentMetrics.memory, disk};
  }

  const [cpu, memory] = await Promise.all([
    readCpuPercent(),
    readMemoryPercent(),
  ]);
  return {cpu, memory, disk};
}

export async function readServiceMetrics(workspace = '/workspace') {
  const [dbConnections, queueDepth] = await Promise.all([
    readDbConnections(workspace),
    readQueueDepth(workspace),
  ]);

  return {dbConnections, queueDepth};
}

export async function readCpuPercent() {
  const cgroup = await readCgroupCpuPercent();
  if (cgroup !== undefined) return cgroup;

  const load = os.loadavg()[0] ?? 0;
  const cpus = Math.max(1, os.cpus().length);
  return Math.min(100, Math.round((load / cpus) * 100));
}

async function readCgroupCpuPercent() {
  try {
    const stat = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8');
    const usageUsec = Number(stat.match(/^usage_usec\s+(\d+)/m)?.[1] ?? NaN);
    if (!Number.isFinite(usageUsec)) return undefined;

    const now = Date.now();
    if (lastCpuSample) {
      const deltaUsageMs = (usageUsec - lastCpuSample.usageUsec) / 1000;
      const deltaWallMs = Math.max(1, now - lastCpuSample.at);
      const ratio = await readCpuQuotaRatio();
      const allowedMs = Math.max(1, deltaWallMs * ratio);
      lastCpuSample = {at: now, usageUsec};
      return Math.min(100, Math.round((deltaUsageMs / allowedMs) * 100));
    }

    lastCpuSample = {at: now, usageUsec};
    return 0;
  } catch {
    return undefined;
  }
}

async function readCpuQuotaRatio() {
  try {
    const raw = await readFile('/sys/fs/cgroup/cpu.max', 'utf8');
    const [quota, period] = raw.trim().split(/\s+/);
    if (quota === 'max') return 1;
    const quotaUs = Number(quota);
    const periodUs = Number(period);
    if (
      !Number.isFinite(quotaUs) ||
      !Number.isFinite(periodUs) ||
      periodUs <= 0
    )
      {return 1;}
    return quotaUs / periodUs;
  } catch {
    return 1;
  }
}

export async function readMemoryPercent() {
  try {
    const [currentRaw, maxRaw] = await Promise.all([
      readFile('/sys/fs/cgroup/memory.current', 'utf8'),
      readFile('/sys/fs/cgroup/memory.max', 'utf8'),
    ]);
    const current = Number(currentRaw.trim());
    const max = Number(maxRaw.trim());
    if (
      Number.isFinite(current) &&
      Number.isFinite(max) &&
      max > 0 &&
      max < Number.MAX_SAFE_INTEGER
    ) {
      return Math.min(100, Math.round((current / max) * 100));
    }
  } catch {
    // fall through
  }

  try {
    const meminfo = await readFile('/proc/meminfo', 'utf8');
    const totalKb = Number(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0);
    const availableKb = Number(
      meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0
    );
    if (totalKb > 0) {
      return Math.min(
        100,
        Math.round(((totalKb - availableKb) / totalKb) * 100)
      );
    }
  } catch {
    // fall through
  }

  const {heapUsed, heapTotal} = process.memoryUsage();
  if (heapTotal > 0) {
    return Math.min(100, Math.round((heapUsed / heapTotal) * 100));
  }

  return 0;
}

/**
 * Total bytes under <workspace>/logs measured against the app's log quota.
 * The quota models a bounded log volume, so `du`-style investigation finds
 * the real culprit file whatever its name.
 */
export async function readLogVolume(workspace, quotaBytes) {
  let quota = quotaBytes;
  if (!Number.isFinite(quota) || quota === undefined) {
    const configResult = await readApiConfig(workspace);
    quota = configResult.ok
      ? configResult.config.logQuotaBytes
      : 512 * 1024 * 1024;
  }

  let bytes = 0;
  try {
    const logDir = path.join(workspace, 'logs');
    for (const entry of await readdir(logDir)) {
      try {
        const info = await stat(path.join(logDir, entry));
        if (info.isFile()) bytes += info.size;
      } catch {
        // file disappeared mid-scan
      }
    }
  } catch {
    // no logs dir yet
  }

  const percent =
    quota > 0 ? Math.min(100, Math.round((bytes / quota) * 100)) : 0;
  return {bytes, quotaBytes: quota, percent};
}

async function readDiskPercent(workspace) {
  let dfPercent = 0;
  try {
    const {stdout} = await execFileAsync('df', ['-P', workspace]);
    const line = stdout.trim().split('\n')[1];
    const usePercent = Number(line?.split(/\s+/)[4]?.replace('%', '') ?? NaN);
    if (Number.isFinite(usePercent))
      {dfPercent = Math.min(100, Math.max(0, usePercent));}
  } catch {
    // fall through
  }

  const logVolume = await readLogVolume(workspace);
  return Math.max(dfPercent, logVolume.percent);
}

async function readDbConnections(workspace) {
  const statsPath = path.join(workspace, 'run', 'fake-db-stats.json');
  if (!existsSync(statsPath)) return 0;
  try {
    const payload = JSON.parse(await readFile(statsPath, 'utf8'));
    return Number.isFinite(payload.connections)
      ? Math.max(0, Math.round(payload.connections))
      : 0;
  } catch {
    return 0;
  }
}

async function readQueueDepth(workspace) {
  const queuePath = path.join(workspace, 'run', 'job-queue.jsonl');
  if (!existsSync(queuePath)) return 0;
  try {
    const content = await readFile(queuePath, 'utf8');
    return content.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * /workspace/etc/monitoring.json selects the metrics source.
 * `{"source":"direct"}` (default, including when the file is absent) reads
 * CPU/memory straight from the sandbox. `{"source":"agent"}` reads them from
 * the monitor-agent's /workspace/run/metrics/agent.json instead, so killing
 * the agent makes monitoring go blind for real (no live data, not a lie).
 */
async function readMonitoringConfig(workspace) {
  const configPath = path.join(workspace, 'etc', 'monitoring.json');
  if (!existsSync(configPath)) return {source: 'direct'};
  try {
    const payload = JSON.parse(await readFile(configPath, 'utf8'));
    return {source: payload.source === 'agent' ? 'agent' : 'direct'};
  } catch {
    return {source: 'direct'};
  }
}

async function readAgentMetrics(workspace) {
  const agentPath = path.join(workspace, 'run', 'metrics', 'agent.json');
  if (!existsSync(agentPath)) return {cpu: null, memory: null};
  try {
    const payload = JSON.parse(await readFile(agentPath, 'utf8'));
    const at = Number(payload.at);
    if (!Number.isFinite(at) || Date.now() - at > AGENT_STALE_AFTER_MS) {
      return {cpu: null, memory: null};
    }
    return {
      cpu: Number.isFinite(payload.cpu) ? payload.cpu : null,
      memory: Number.isFinite(payload.memory) ? payload.memory : null,
    };
  } catch {
    return {cpu: null, memory: null};
  }
}
