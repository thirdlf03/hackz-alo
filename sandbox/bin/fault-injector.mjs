#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";
const USAGE =
  "usage: fault-injector.mjs process_stop|process_restore|disk_full|queue_backlog|unlang_batch_failure|janitor_power_pull|cable_jumprope|keyboard_spill|alert_spam|runbook_gaslight";

export async function injectFault(fault, args = [], options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  await mkdir(path.join(workspace, "logs"), { recursive: true });
  await mkdir(path.join(workspace, "run"), { recursive: true });

  if (fault === "process_stop") {
    const processId = args[0] ?? "api";
    if (processId !== "api") throw new Error(`unsupported process ${processId}`);
    await writeFile(path.join(workspace, "run", "api.down"), new Date().toISOString());
    await appendFile(path.join(workspace, "logs", "app.log"), "api process stopped by scenario\n");
    await stopApiProcess();
    return "process_stop injected";
  }

  if (fault === "process_restore") {
    await rm(path.join(workspace, "run", "api.down"), { force: true });
    await appendFile(path.join(workspace, "logs", "app.log"), "api process restored\n");
    return "process_restore injected";
  }

  if (fault === "disk_full") {
    const target = args[0] ?? path.join(workspace, "logs", "debug.log");
    const bytes = parseByteCount(args[1] ?? 64 * 1024 * 1024);
    const safeTarget = normalizeWorkspacePath(target, workspace);
    await mkdir(path.dirname(safeTarget), { recursive: true });
    await appendExactBytes(safeTarget, bytes);
    const totalBytes = (await stat(safeTarget)).size;
    await appendFile(path.join(workspace, "logs", "app.log"), `debug log expanded to ${totalBytes} bytes\n`);
    return "disk_full injected";
  }

  if (fault === "queue_backlog") {
    const count = parseByteCount(args[0] ?? 32);
    const lines = Array.from({ length: count }, (_, index) =>
      JSON.stringify({ id: `backlog-${Date.now()}-${index}`, status: "pending" })
    ).join("\n");
    await appendFile(path.join(workspace, "run", "job-queue.jsonl"), `${lines}\n`);
    return `queue_backlog injected (${count})`;
  }

  if (fault === "unlang_batch_failure") {
    const target = normalizeWorkspacePath(args[0] ?? path.join(workspace, "services", "batch", "sales.un"), workspace);
    const jobId = args[1] ?? "sales-nightly";
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "うんちく 売上集計バッチ\nうん x = 100\nうん y = うんなし\nうん z = x うんわり y\nうん！ z\n");
    await appendFile(path.join(workspace, "logs", "batch.log"), `${jobId}: うんともすんとも\n`);
    await appendFile(
      path.join(workspace, "run", "job-queue.jsonl"),
      `${JSON.stringify({ id: jobId, status: "failed" })}\n`
    );
    return "unlang_batch_failure injected";
  }

  if (fault === "bad_deploy") {
    const configPath = normalizeWorkspacePath(args[0] ?? path.join(workspace, "run", "deploy.json"), workspace);
    await writeFile(configPath, JSON.stringify({ healthPath: "/broken-health", deployedAt: new Date().toISOString() }));
    await appendFile(path.join(workspace, "logs", "app.log"), "bad deploy marker written\n");
    return "bad_deploy injected";
  }

  if (fault === "db_pool_exhaust") {
    const maxConnections = parseByteCount(args[0] ?? 40);
    await writeFile(path.join(workspace, "run", "db.pool.exhausted"), String(maxConnections));
    await appendFile(path.join(workspace, "logs", "app.log"), `db pool exhausted (${maxConnections})\n`);
    return "db_pool_exhaust injected";
  }

  if (fault === "memory_leak") {
    const targetPercent = parseByteCount(args[0] ?? 92);
    await writeFile(path.join(workspace, "run", "memory.leak"), String(targetPercent));
    await appendFile(path.join(workspace, "logs", "app.log"), `memory leak simulated at ${targetPercent}%\n`);
    return "memory_leak injected";
  }

  if (fault === "dns_misconfig") {
    const hostsPath = normalizeWorkspacePath(args[0] ?? path.join(workspace, "run", "hosts.override"), workspace);
    await writeFile(hostsPath, "127.0.0.1 localhost-broken\n");
    await appendFile(path.join(workspace, "logs", "app.log"), "dns misconfig marker written\n");
    return "dns_misconfig injected";
  }

  if (fault === "monitor_blind") {
    const blindMetrics = JSON.parse(args[0] ?? '["cpu","memory"]');
    await writeFile(path.join(workspace, "run", "monitor.blind.json"), JSON.stringify({ blindMetrics }));
    await appendFile(path.join(workspace, "logs", "app.log"), `monitor blind: ${blindMetrics.join(",")}\n`);
    return "monitor_blind injected";
  }

  if (fault === "composite_restart_loop") {
    const diskPath = args[0] ?? path.join(workspace, "logs", "debug.log");
    const bytes = parseByteCount(args[1] ?? 64 * 1024 * 1024);
    const processId = args[2] ?? "api";
    await injectFault("disk_full", [diskPath, String(bytes)], { workspace });
    await injectFault("process_stop", [processId], { workspace });
    await appendFile(path.join(workspace, "logs", "app.log"), "composite restart loop injected\n");
    return "composite_restart_loop injected";
  }

  if (fault === "janitor_power_pull") {
    const processId = args[0] ?? "api";
    if (processId !== "api") throw new Error(`unsupported process ${processId}`);
    const pulledAt = new Date().toISOString();
    await writeFile(path.join(workspace, "run", "api.down"), pulledAt);
    await writeFile(
      path.join(workspace, "run", "janitor.power.pulled"),
      JSON.stringify({ pulledAt, culprit: "janitor", redundantSystems: false })
    );
    await appendFile(path.join(workspace, "logs", "app.log"), "janitor unplugged api power during cleaning\n");
    return "janitor_power_pull injected";
  }

  if (fault === "cable_jumprope") {
    const hostsPath = normalizeWorkspacePath(args[0] ?? path.join(workspace, "run", "hosts.override"), workspace);
    const disconnectedAt = new Date().toISOString();
    await writeFile(hostsPath, "127.0.0.1 localhost-broken\n");
    await writeFile(
      path.join(workspace, "run", "network.jumprope"),
      JSON.stringify({ sport: "jumprope", cable: "eth0", disconnectedAt })
    );
    await writeFile(path.join(workspace, "run", "api.down"), `cable jumprope ${disconnectedAt}`);
    await appendFile(path.join(workspace, "logs", "app.log"), "LAN cable unplugged for jumprope session\n");
    return "cable_jumprope injected";
  }

  if (fault === "keyboard_spill") {
    const noise = args[0] ?? "べちゃっxべちゃっ";
    const spilledAt = new Date().toISOString();
    await writeFile(
      path.join(workspace, "run", "keyboard.spill"),
      JSON.stringify({ beverage: "fridge sake", noise, spilledAt })
    );
    await writeFile(path.join(workspace, "run", "terminal.noise"), noise.repeat(3));
    await appendFile(path.join(workspace, "logs", "app.log"), "keyboard spill detected on operator terminal\n");
    return "keyboard_spill injected";
  }

  if (fault === "alert_spam") {
    const count = parseByteCount(args[0] ?? 24);
    const alerts = Array.from({ length: count }, (_, index) => ({
      id: `spam-${Date.now()}-${index}`,
      severity: index % 3 === 0 ? "critical" : "warning",
      message: index % 2 === 0 ? "CPU fan is dancing" : "Red Bull level below wing threshold"
    }));
    await writeFile(
      path.join(workspace, "run", "alert.spam.json"),
      JSON.stringify({ count, alerts, injectedAt: new Date().toISOString() })
    );
    for (const alert of alerts.slice(0, 5)) {
      await appendFile(path.join(workspace, "logs", "app.log"), `noise alert: ${alert.message}\n`);
    }
    return `alert_spam injected (${count})`;
  }

  if (fault === "runbook_gaslight") {
    const replacement = args[0] ?? "気合いで直す。根性。深呼吸。";
    await writeFile(
      path.join(workspace, "run", "runbook.gaslight.json"),
      JSON.stringify({ replacement, gaslitAt: new Date().toISOString(), originalIntegrity: "compromised" })
    );
    await appendFile(path.join(workspace, "logs", "app.log"), "runbook content replaced with unhelpful advice\n");
    return "runbook_gaslight injected";
  }

  throw usageError();
}

async function stopApiProcess() {
  try {
    await execFileAsync("pkill", ["-f", "unyoh-api/server.mjs"]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 1) return;
    throw error;
  }
}

export function normalizeWorkspacePath(value, workspace = DEFAULT_WORKSPACE) {
  const root = path.resolve(workspace);
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("target path must stay inside workspace");
  }
  return resolved;
}

async function appendExactBytes(file, bytes) {
  const chunk = Buffer.alloc(1024 * 1024, "x");
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    await appendFile(file, size === chunk.length ? chunk : chunk.subarray(0, size));
    remaining -= size;
  }
}

function parseByteCount(value) {
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error("byte count must be a non-negative integer");
  }
  return bytes;
}

function usageError() {
  const error = new Error(USAGE);
  error.code = "USAGE";
  return error;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [fault, ...args] = process.argv.slice(2);
  try {
    console.log(await injectFault(fault, args));
  } catch (error) {
    console.error(error.code === "USAGE" ? USAGE : error.message);
    process.exit(1);
  }
}
