import { getSandbox, type PtyOptions, type Sandbox } from "@cloudflare/sandbox";
import type { MetricsSnapshot, ScenarioDefinition, SuccessCondition } from "@incident/shared";
import type { Bindings } from "../types.js";
import { installSandboxAssets } from "./assets.js";

export type SandboxRuntime = Sandbox;

export function getSessionSandbox(env: Bindings, sessionId: string): SandboxRuntime {
  return getSandbox(env.Sandbox, sessionSandboxName(sessionId));
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
  const script = [
    'fetch("http://127.0.0.1:8080/metrics")',
    ".then(async (response) => {",
    "  if (!response.ok) process.exit(1);",
    "  process.stdout.write(await response.text());",
    "})",
    ".catch(() => process.exit(1));"
  ].join("");
  const result = await sandbox.exec(`node -e ${shellArg(script)}`);
  if (!result.success || !result.stdout?.trim()) return null;
  try {
    return parseMetricsSnapshot(JSON.parse(result.stdout) as Record<string, unknown>);
  } catch {
    return null;
  }
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
