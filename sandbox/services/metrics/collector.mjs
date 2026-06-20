import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let lastCpuSample = undefined;

export class RequestMetricsTracker {
  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  record(status, durationMs) {
    const at = Date.now();
    this.samples.push({ at, status, durationMs });
    this.prune(at);
  }

  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((sample) => sample.at >= cutoff);
  }

  snapshot() {
    this.prune();
    const total = this.samples.length;
    if (total === 0) {
      return { http5xxRate: 0, latencyP95Ms: 0, rps: 0 };
    }

    const errors = this.samples.filter((sample) => sample.status >= 500).length;
    const durations = this.samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);

    return {
      http5xxRate: errors / total,
      latencyP95Ms: durations[p95Index] ?? 0,
      rps: Math.round(total / (this.windowMs / 1000))
    };
  }
}

export async function readSystemMetrics(workspace = "/workspace") {
  const [cpu, memory, disk] = await Promise.all([
    readCpuPercent(),
    readMemoryPercent(),
    readDiskPercent(workspace)
  ]);

  return { cpu, memory, disk };
}

export async function readServiceMetrics(workspace = "/workspace") {
  const [dbConnections, queueDepth] = await Promise.all([
    readDbConnections(workspace),
    readQueueDepth(workspace)
  ]);

  return { dbConnections, queueDepth };
}

async function readCpuPercent() {
  const cgroup = await readCgroupCpuPercent();
  if (cgroup !== undefined) return cgroup;

  const load = os.loadavg()[0] ?? 0;
  const cpus = Math.max(1, os.cpus().length);
  return Math.min(100, Math.round((load / cpus) * 100));
}

async function readCgroupCpuPercent() {
  try {
    const stat = await readFile("/sys/fs/cgroup/cpu.stat", "utf8");
    const usageUsec = Number(stat.match(/^usage_usec\s+(\d+)/m)?.[1] ?? NaN);
    if (!Number.isFinite(usageUsec)) return undefined;

    const now = Date.now();
    if (lastCpuSample) {
      const deltaUsageMs = (usageUsec - lastCpuSample.usageUsec) / 1000;
      const deltaWallMs = Math.max(1, now - lastCpuSample.at);
      const ratio = await readCpuQuotaRatio();
      const allowedMs = Math.max(1, deltaWallMs * ratio);
      lastCpuSample = { at: now, usageUsec };
      return Math.min(100, Math.round((deltaUsageMs / allowedMs) * 100));
    }

    lastCpuSample = { at: now, usageUsec };
    return 0;
  } catch {
    return undefined;
  }
}

async function readCpuQuotaRatio() {
  try {
    const raw = await readFile("/sys/fs/cgroup/cpu.max", "utf8");
    const [quota, period] = raw.trim().split(/\s+/);
    if (quota === "max") return 1;
    const quotaUs = Number(quota);
    const periodUs = Number(period);
    if (!Number.isFinite(quotaUs) || !Number.isFinite(periodUs) || periodUs <= 0) return 1;
    return quotaUs / periodUs;
  } catch {
    return 1;
  }
}

async function readMemoryPercent() {
  try {
    const [currentRaw, maxRaw] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
      readFile("/sys/fs/cgroup/memory.max", "utf8")
    ]);
    const current = Number(currentRaw.trim());
    const max = Number(maxRaw.trim());
    if (Number.isFinite(current) && Number.isFinite(max) && max > 0 && max < Number.MAX_SAFE_INTEGER) {
      return Math.min(100, Math.round((current / max) * 100));
    }
  } catch {
    // fall through
  }

  try {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const totalKb = Number(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0);
    const availableKb = Number(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0);
    if (totalKb > 0) {
      return Math.min(100, Math.round(((totalKb - availableKb) / totalKb) * 100));
    }
  } catch {
    // fall through
  }

  const { heapUsed, heapTotal } = process.memoryUsage();
  if (heapTotal > 0) {
    return Math.min(100, Math.round((heapUsed / heapTotal) * 100));
  }

  return 0;
}

async function readDiskPercent(workspace) {
  try {
    const { stdout } = await execFileAsync("df", ["-P", workspace]);
    const line = stdout.trim().split("\n")[1];
    const usePercent = Number(line?.split(/\s+/)[4]?.replace("%", "") ?? NaN);
    if (Number.isFinite(usePercent)) return Math.min(100, Math.max(0, usePercent));
  } catch {
    // fall through
  }

  return 0;
}

async function readDbConnections(workspace) {
  const statsPath = path.join(workspace, "run", "fake-db-stats.json");
  if (!existsSync(statsPath)) return 0;
  try {
    const payload = JSON.parse(await readFile(statsPath, "utf8"));
    return Number.isFinite(payload.connections) ? Math.max(0, Math.round(payload.connections)) : 0;
  } catch {
    return 0;
  }
}

async function readQueueDepth(workspace) {
  const queuePath = path.join(workspace, "run", "job-queue.jsonl");
  if (!existsSync(queuePath)) return 0;
  try {
    const content = await readFile(queuePath, "utf8");
    return content.split("\n").filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}
