import { getSandbox, type PtyOptions, type Sandbox } from "@cloudflare/sandbox";
import type { MetricsSnapshot, ScenarioDefinition, SuccessCondition } from "@incident/shared";
import type { Bindings } from "../types.js";
import { installSandboxAssets } from "./assets.js";

export type SandboxRuntime = Sandbox;

const SANDBOX_SLEEP_AFTER = "3m";

export function getSessionSandbox(env: Bindings, sessionId: string): SandboxRuntime {
  return getSandbox(env.Sandbox, sessionSandboxName(sessionId), { sleepAfter: SANDBOX_SLEEP_AFTER });
}

export function proxySessionTerminal(
  env: Bindings,
  sessionId: string,
  request: Request,
  options?: PtyOptions
) {
  return (getSessionSandbox(env, sessionId) as SandboxRuntime & {
    terminal(request: Request, options?: PtyOptions): Response | Promise<Response>;
  }).terminal(request, options);
}

export type EditableFileEntry = {
  path: string;
  size: number;
};

type SandboxFileApi = SandboxRuntime & {
  readFile(path: string): Promise<{ content: string } | string>;
  writeFile(path: string, content: string): Promise<unknown>;
};

/**
 * Cloudflare Sandbox 0.12.x PTY (Bun.Terminal) echoes ^C but does not deliver
 * SIGINT to the foreground process group. Send INT to the interactive bash instead.
 */
export async function interruptSessionTerminal(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    "for pid in $(pgrep -x bash); do",
    '  args=$(ps -p "$pid" -o args= 2>/dev/null || continue)',
    '  case "$args" in *"--norc"*) continue ;; esac',
    '  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " ")',
    '  if [ -n "$pgid" ]; then kill -INT "-$pgid" 2>/dev/null || kill -INT "$pid" 2>/dev/null || true; fi',
    "  break",
    "done"
  ].join("\n");
  await sandbox.exec(`bash -lc ${shellArg(script)}`, { cwd: "/workspace" });
}

export async function startScenarioSandbox(
  env: Bindings,
  sessionId: string,
  scenario: ScenarioDefinition
) {
  const sandbox = getSessionSandbox(env, sessionId);
  await installSandboxAssets(sandbox);
  await sandbox.exec(
    "mkdir -p /workspace/logs /workspace/run && rm -f /workspace/run/api.down /workspace/logs/debug.log /workspace/logs/batch.log",
    { cwd: "/workspace" }
  );

  const started: Array<{ id: string; command: string; waitForPort?: number }> = [];
  for (const process of scenario.startup) {
    const child = await sandbox.startProcess(process.command, {
      processId: process.id,
      cwd: "/workspace",
      autoCleanup: false
    });
    if (process.waitForPort !== undefined) {
      await child.waitForPort(process.waitForPort, {
        mode: "tcp",
        timeout: 30_000
      });
    }
    started.push({
      id: process.id,
      command: process.command,
      ...(process.waitForPort === undefined ? {} : { waitForPort: process.waitForPort })
    });
  }
  return started;
}

export async function fetchSessionMetrics(env: Bindings, sessionId: string): Promise<MetricsSnapshot | null> {
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await sandbox.exec("node /workspace/services/metrics/export.mjs", { cwd: "/workspace" });
  if (!result.success || !result.stdout?.trim()) {
    console.error("[sandbox-metrics]", compactSandboxExecFailure(result));
    return null;
  }
  try {
    return parseMetricsSnapshot(JSON.parse(result.stdout) as Record<string, unknown>);
  } catch (error) {
    console.error("[sandbox-metrics]", compactSandboxExecFailure(result, error));
    return null;
  }
}

export async function fetchSessionLogs(
  env: Bindings,
  sessionId: string,
  file: string,
  tail: number
): Promise<string[]> {
  const allowed = new Set(["access", "app", "batch"]);
  if (!allowed.has(file)) return [];
  const path = `/workspace/logs/${file}.log`;
  const lines = Math.max(1, Math.min(200, Number.isFinite(tail) ? tail : 50));
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await sandbox.exec(`tail -n ${lines} ${shellArg(path)}`);
  if (!result.success || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

export async function fetchSessionStorage(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    "const fs=require('fs');const path=require('path');",
    "const run='/workspace/run';",
    "const entries=[];",
    "if(fs.existsSync(path.join(run,'api.down'))) entries.push({key:'api.down',value:fs.readFileSync(path.join(run,'api.down'),'utf8')});",
    "if(fs.existsSync(path.join(run,'db.pool.exhausted'))) entries.push({key:'db.pool.exhausted',value:'true'});",
    "if(fs.existsSync(path.join(run,'monitor.blind.json'))) entries.push({key:'monitor.blind',value:fs.readFileSync(path.join(run,'monitor.blind.json'),'utf8')});",
    "if(fs.existsSync(path.join(run,'job-queue.jsonl'))) entries.push({key:'job-queue',value:fs.readFileSync(path.join(run,'job-queue.jsonl'),'utf8').split('\\n').slice(-5).join('\\n')});",
    "if(fs.existsSync(path.join(run,'fake-db-stats.json'))) entries.push({key:'fake-db-stats',value:fs.readFileSync(path.join(run,'fake-db-stats.json'),'utf8').trim()});",
    "process.stdout.write(JSON.stringify(entries));"
  ].join("");
  const result = await sandbox.exec(`node -e ${shellArg(script)}`);
  if (!result.success || !result.stdout?.trim()) return [];
  try {
    return JSON.parse(result.stdout) as Array<{ key: string; value: string }>;
  } catch {
    return [];
  }
}

export async function listSessionFiles(env: Bindings, sessionId: string): Promise<EditableFileEntry[]> {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    "const fs=require('fs');const path=require('path');",
    "const roots=['/workspace/services','/workspace/run'];",
    "const out=[];",
    "function walk(dir){",
    "  if(!fs.existsSync(dir)) return;",
    "  for(const name of fs.readdirSync(dir)){",
    "    const file=path.join(dir,name);",
    "    let stat;",
    "    try{stat=fs.statSync(file);}catch{continue;}",
    "    if(stat.isDirectory()){walk(file);continue;}",
    "    if(!stat.isFile()||stat.size>200000) continue;",
    "    out.push({path:file,size:stat.size});",
    "  }",
    "}",
    "for(const root of roots) walk(root);",
    "out.sort((a,b)=>a.path.localeCompare(b.path));",
    "process.stdout.write(JSON.stringify(out));"
  ].join("");
  const result = await sandbox.exec(`node -e ${shellArg(script)}`, { cwd: "/workspace" });
  if (!result.success || !result.stdout?.trim()) return [];
  try {
    const files = JSON.parse(result.stdout) as EditableFileEntry[];
    return files.filter((file) => isWorkspacePath(file.path) && Number.isFinite(file.size));
  } catch {
    return [];
  }
}

export async function readSessionFile(env: Bindings, sessionId: string, path: string) {
  const safePath = normalizeEditableWorkspacePath(path);
  const sandbox = getSessionSandbox(env, sessionId) as SandboxFileApi;
  const file = await sandbox.readFile(safePath);
  const content = typeof file === "string" ? file : file.content;
  return { path: safePath, content };
}

export async function writeSessionFile(env: Bindings, sessionId: string, path: string, content: string) {
  const safePath = normalizeEditableWorkspacePath(path);
  if (content.length > 200_000) throw new Error("file content is too large");
  const sandbox = getSessionSandbox(env, sessionId) as SandboxFileApi;
  await sandbox.writeFile(safePath, content);
  return { path: safePath, byteLength: new TextEncoder().encode(content).length };
}

export async function injectFault(
  env: Bindings,
  sessionId: string,
  type: string,
  params: Record<string, unknown>
) {
  const sandbox = getSessionSandbox(env, sessionId);
  if (type === "process_stop") {
    await sandbox.exec(`node /workspace/bin/fault-injector.mjs process_stop ${shellArg(String(params.processId ?? "api"))}`);
  } else if (type === "disk_full") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs disk_full ${shellArg(String(params.path ?? "/workspace/logs/debug.log"))} ${Number(params.bytes ?? 67108864)}`
    );
  } else if (type === "unlang_batch_failure") {
    await sandbox.exec("node /workspace/bin/fault-injector.mjs unlang_batch_failure");
  } else if (type === "queue_backlog") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs queue_backlog ${Number(params.count ?? 32)}`
    );
  } else if (type === "bad_deploy") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs bad_deploy ${shellArg(String(params.configPath ?? "/workspace/run/deploy.json"))}`
    );
  } else if (type === "db_pool_exhaust") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs db_pool_exhaust ${Number(params.maxConnections ?? 40)}`
    );
  } else if (type === "memory_leak") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs memory_leak ${Number(params.targetPercent ?? 92)}`
    );
  } else if (type === "dns_misconfig") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs dns_misconfig ${shellArg(String(params.hostsPath ?? "/workspace/run/hosts.override"))}`
    );
  } else if (type === "monitor_blind") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs monitor_blind ${shellArg(JSON.stringify(params.blindMetrics ?? ["cpu", "memory"]))}`
    );
  } else if (type === "composite_restart_loop") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs composite_restart_loop ${shellArg(String(params.diskPath ?? "/workspace/logs/debug.log"))} ${Number(params.bytes ?? 67108864)} ${shellArg(String(params.processId ?? "api"))}`
    );
  } else if (type === "janitor_power_pull") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs janitor_power_pull ${shellArg(String(params.processId ?? "api"))}`
    );
  } else if (type === "cable_jumprope") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs cable_jumprope ${shellArg(String(params.hostsPath ?? "/workspace/run/hosts.override"))}`
    );
  } else if (type === "keyboard_spill") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs keyboard_spill ${shellArg(String(params.noise ?? "べちゃっxべちゃっ"))}`
    );
  } else if (type === "alert_spam") {
    await sandbox.exec(`node /workspace/bin/fault-injector.mjs alert_spam ${Number(params.count ?? 24)}`);
  } else if (type === "runbook_gaslight") {
    await sandbox.exec(
      `node /workspace/bin/fault-injector.mjs runbook_gaslight ${shellArg(String(params.replacement ?? "気合いで直す。根性。深呼吸。"))}`
    );
  } else {
    throw new Error(`unknown fault type: ${type}`);
  }
}

export async function evaluateSuccessCondition(env: Bindings, sessionId: string, condition: SuccessCondition) {
  const sandbox = getSessionSandbox(env, sessionId);
  if (condition.type === "http_status") {
    const script = `fetch(${JSON.stringify(condition.url)}).then(r=>process.exit(r.status===${condition.status}?0:1)).catch(()=>process.exit(1))`;
    const result = await sandbox.exec(`node -e ${shellArg(script)}`);
    return result.success;
  }
  if (condition.type === "process_running") {
    const result = await sandbox.exec(`test ! -f /workspace/run/${shellPathSegment(condition.processId)}.down`);
    return result.success;
  }
  if (condition.type === "marker_absent") {
    const markerPath = shellArg(normalizeWorkspaceMarkerPath(condition.path));
    const result = await sandbox.exec(`test ! -e ${markerPath}`);
    return result.success;
  }
  if (condition.type === "disk_usage_below") {
    const script = `const {execFileSync}=require("child_process");const target=${JSON.stringify(condition.path)};let used=100;try{const out=execFileSync("df",["-P",target],{encoding:"utf8"});const line=out.trim().split("\\n")[1];used=Number(line.split(/\\s+/)[4].replace("%",""));}catch{}process.exit(used<${condition.valuePercent}?0:1)`;
    const result = await sandbox.exec(`node -e ${shellArg(script)}`);
    return result.success;
  }
  if (condition.type === "log_absent") {
    const script = `const fs=require("fs");const p=${JSON.stringify(condition.path)};const text=fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";process.exit(text.includes(${JSON.stringify(condition.pattern)})?1:0)`;
    const result = await sandbox.exec(`node -e ${shellArg(script)}`);
    return result.success;
  }
  if (condition.type === "unlang_batch_ok") {
    const result = await sandbox.exec("node /workspace/bin/unlang.mjs run /workspace/services/batch/sales.un");
    return result.success;
  }
  return false;
}

function parseMetricsSnapshot(payload: Record<string, unknown>): MetricsSnapshot | null {
  const numbers = [
    "cpu",
    "memory",
    "disk",
    "http5xxRate",
    "latencyP95Ms",
    "rps",
    "dbConnections",
    "queueDepth"
  ] as const;
  for (const key of numbers) {
    if (typeof payload[key] !== "number" || !Number.isFinite(payload[key])) return null;
  }
  return {
    at: typeof payload.at === "number" ? payload.at : Date.now(),
    cpu: payload.cpu as number,
    memory: payload.memory as number,
    disk: payload.disk as number,
    http5xxRate: payload.http5xxRate as number,
    latencyP95Ms: payload.latencyP95Ms as number,
    rps: payload.rps as number,
    dbConnections: payload.dbConnections as number,
    queueDepth: payload.queueDepth as number
  };
}

function compactSandboxExecFailure(
  result: { success?: boolean; stdout?: string; stderr?: string },
  error?: unknown
) {
  const details = [
    `success=${String(result.success)}`,
    result.stderr?.trim() ? `stderr=${truncateLogField(result.stderr)}` : undefined,
    result.stdout?.trim() ? `stdout=${truncateLogField(result.stdout)}` : undefined,
    error instanceof Error ? `error=${error.message}` : error ? `error=${String(error)}` : undefined
  ].filter(Boolean);
  return details.join(" ");
}

function truncateLogField(value: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

export async function destroySessionSandbox(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  try {
    await sandbox.killAllProcesses();
  } catch {
    // best effort
  }
  try {
    await (sandbox as SandboxRuntime & { destroy(): Promise<void> }).destroy();
  } catch {
    // best effort
  }
}

function sessionSandboxName(sessionId: string) {
  return `session-${sessionId}`;
}

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function shellPathSegment(value: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error("invalid process id");
  }
  return value;
}

function normalizeWorkspaceMarkerPath(value: string) {
  if (!value.startsWith("/workspace/") || value.includes("\0") || value.split("/").includes("..")) {
    throw new Error("marker path must stay inside /workspace");
  }
  return value;
}

function normalizeEditableWorkspacePath(value: string) {
  if (!isWorkspacePath(value)) throw new Error("path must stay inside /workspace");
  if (!value.startsWith("/workspace/services/") && !value.startsWith("/workspace/run/")) {
    throw new Error("editable files must be under /workspace/services or /workspace/run");
  }
  if (value.includes("\0") || value.split("/").includes("..")) throw new Error("invalid file path");
  return value;
}

function isWorkspacePath(value: string) {
  return value.startsWith("/workspace/") && !value.includes("\0") && !value.split("/").includes("..");
}
