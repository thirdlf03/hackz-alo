import type { SandboxRuntime } from "./runtime.js";

type SandboxAsset = {
  path: string;
  content: string;
};

const assets: SandboxAsset[] = [
  {
    path: "/workspace/services/unyoh-api/server.mjs",
    content: String.raw`
import http from "node:http";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const workspace = process.env.WORKSPACE_DIR ?? "/workspace";
const logDir = path.join(workspace, "logs");
const port = Number(process.env.PORT ?? 8080);

await mkdir(logDir, { recursive: true });
await mkdir(path.join(workspace, "run"), { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const health = await getHealth();
  let status = 404;
  let payload = { error: "not_found" };
  if (url.pathname === "/health") {
    status = health.ok ? 200 : 500;
    payload = health;
  } else if (url.pathname === "/orders") {
    status = health.ok ? 200 : 500;
    payload = health.ok ? { orders: [{ id: "ord_001", amount: 1200 }] } : { error: health.reason };
  } else if (url.pathname === "/metrics") {
    status = 200;
    payload = await getMetrics(health);
  }
  await appendFile(path.join(logDir, "access.log"), new Date().toISOString() + " " + req.method + " " + url.pathname + " " + status + "\n");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
});

server.listen(port, () => console.log("unyoh-api listening on " + port));

async function getHealth() {
  if (existsSync(path.join(workspace, "run", "api.down"))) return { ok: false, reason: "process marker says api is down" };
  const debugLog = path.join(logDir, "debug.log");
  if (existsSync(debugLog) && (await stat(debugLog)).size > 50 * 1024 * 1024) {
    return { ok: false, reason: "disk pressure from debug.log" };
  }
  return { ok: true };
}

async function getMetrics(health) {
  let debugLogSize = 0;
  try { debugLogSize = (await stat(path.join(logDir, "debug.log"))).size; } catch {}
  const disk = Math.min(100, Math.round((debugLogSize / (60 * 1024 * 1024)) * 100));
  return {
    at: Date.now(),
    cpu: health.ok ? 28 : 88,
    memory: health.ok ? 44 : 71,
    disk,
    http5xxRate: health.ok ? 0 : 0.35,
    latencyP95Ms: health.ok ? 120 : 1800,
    rps: health.ok ? 42 : 3,
    dbConnections: health.ok ? 6 : 0,
    queueDepth: health.ok ? 2 : 34
  };
}
`.trimStart()
  },
  {
    path: "/workspace/services/fake-db/server.mjs",
    content: String.raw`
import net from "node:net";

const port = Number(process.env.FAKE_DB_PORT ?? 15432);
const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("fake-db ready\n");
  socket.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) {
      const normalized = line.toLowerCase();
      if (normalized === "ping") socket.write("pong\n");
      else if (normalized === "select 1" || normalized === "select 1;") socket.write("row 1\n");
      else if (normalized === "quit" || normalized === "exit") {
        socket.write("bye\n");
        socket.end();
      } else socket.write("ok " + line + "\n");
    }
  });
});
server.listen(port, () => console.log("fake-db listening on " + port));
`.trimStart()
  },
  {
    path: "/workspace/bin/fault-injector.mjs",
    content: String.raw`
import { appendFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = process.env.WORKSPACE_DIR ?? "/workspace";
const [fault, ...args] = process.argv.slice(2);
await mkdir(path.join(workspace, "logs"), { recursive: true });
await mkdir(path.join(workspace, "run"), { recursive: true });

if (fault === "process_stop") {
  await writeFile(path.join(workspace, "run", "api.down"), new Date().toISOString());
  await appendFile(path.join(workspace, "logs", "app.log"), "api process stopped by scenario\n");
  console.log("process_stop injected");
} else if (fault === "process_restore") {
  await rm(path.join(workspace, "run", "api.down"), { force: true });
  await appendFile(path.join(workspace, "logs", "app.log"), "api process restored\n");
  console.log("process_restore injected");
} else if (fault === "disk_full") {
  const target = normalizeWorkspacePath(args[0] ?? "/workspace/logs/debug.log");
  const bytes = Number(args[1] ?? 64 * 1024 * 1024);
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error("byte count must be a non-negative integer");
  await mkdir(path.dirname(target), { recursive: true });
  const chunk = Buffer.alloc(1024 * 1024, "x");
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    await appendFile(target, size === chunk.length ? chunk : chunk.subarray(0, size));
    remaining -= size;
  }
  await appendFile(path.join(workspace, "logs", "app.log"), "debug log expanded to " + (await stat(target)).size + " bytes\n");
  console.log("disk_full injected");
} else if (fault === "unlang_batch_failure") {
  const target = normalizeWorkspacePath(args[0] ?? "/workspace/services/batch/sales.un");
  const jobId = args[1] ?? "sales-nightly";
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "うんちく 売上集計バッチ\nうん x = 100\nうん y = うんなし\nうん z = x うんわり y\nうん！ z\n");
  await appendFile(path.join(workspace, "logs", "batch.log"), jobId + ": うんともすんとも\n");
  console.log("unlang_batch_failure injected");
} else {
  console.error("usage: fault-injector.mjs process_stop|process_restore|disk_full|unlang_batch_failure");
  process.exit(1);
}

function normalizeWorkspacePath(value) {
  const root = path.resolve(workspace);
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("target path must stay inside workspace");
  return resolved;
}
`.trimStart()
  },
  {
    path: "/workspace/bin/unctl.mjs",
    content: String.raw`
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = process.env.WORKSPACE_DIR ?? "/workspace";
const [command, service] = process.argv.slice(2);
const runDir = path.join(workspace, "run");
const marker = path.join(runDir, "api.down");
await mkdir(runDir, { recursive: true });
if (service !== "api" || !["status", "restart", "stop"].includes(command)) {
  console.error("usage: unctl <status|restart|stop> api");
  process.exit(1);
}
if (command === "status") console.log((await exists(marker)) ? "api stopped" : "api running");
if (command === "restart") {
  await rm(marker, { force: true });
  console.log("api restarted");
}
if (command === "stop") {
  await writeFile(marker, new Date().toISOString());
  console.log("api stopped");
}
async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}
`.trimStart()
  },
  {
    path: "/workspace/bin/unlang.mjs",
    content: String.raw`
import { readFile } from "node:fs/promises";

function runUnlang(source) {
  const env = new Map();
  let lastValue = 0;
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("うんちく")) continue;
    if (line.startsWith("うん！")) {
      const expr = line.slice("うん！".length).trim();
      return expr ? evaluate(expr, env, index + 1) : lastValue;
    }
    const match = line.match(/^うん\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/u);
    if (match) {
      const value = evaluate(match[2], env, index + 1);
      env.set(match[1], value);
      lastValue = value;
      continue;
    }
    throw runtimeError("SYNTAX_ERROR", index + 1);
  }
  return lastValue;
}

function evaluate(expression, env, line) {
  const tokens = expression.match(/\(|\)|[^\s()]+/gu) ?? [];
  let index = 0;
  const parseExpression = () => {
    let value = parseTerm();
    while (tokens[index] === "うんたす" || tokens[index] === "うんひく") {
      const op = tokens[index++];
      const right = parseTerm();
      value = op === "うんたす" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = () => {
    let value = parseFactor();
    while (tokens[index] === "うんかけ" || tokens[index] === "うんわり") {
      const op = tokens[index++];
      const right = parseFactor();
      if (op === "うんわり" && right === 0) throw runtimeError("DIVISION_BY_ZERO", line);
      value = op === "うんかけ" ? value * right : value / right;
    }
    return value;
  };
  const parseFactor = () => {
    const token = tokens[index++];
    if (token === "(") {
      const value = parseExpression();
      if (tokens[index++] !== ")") throw runtimeError("SYNTAX_ERROR", line);
      return value;
    }
    if (token === "うんなし") return 0;
    if (token === "うんあり") return 1;
    if (/^-?\d+(\.\d+)?$/u.test(token ?? "")) return Number(token);
    if (token && env.has(token)) return env.get(token);
    throw runtimeError("UNDEFINED_VARIABLE", line);
  };
  const value = parseExpression();
  if (index !== tokens.length) throw runtimeError("SYNTAX_ERROR", line);
  return value;
}

function runtimeError(code, line) {
  const error = new Error("うんともすんとも");
  error.code = code;
  error.line = line;
  return error;
}

const [command, file] = process.argv.slice(2);
if ((command !== "run" && command !== "check") || !file) {
  console.error("usage: unlang <run|check> <file>");
  process.exit(1);
}
try {
  const result = runUnlang(await readFile(file, "utf8"));
  console.log(command === "run" ? result : "ok");
} catch {
  console.error("うんともすんとも");
  process.exit(1);
}
`.trimStart()
  },
  {
    path: "/workspace/services/batch/sales.un",
    content: "うんちく 売上集計バッチ\nうん x = 100\nうん y = うんあり\nうん z = x うんわり y\nうん！ z\n"
  }
];

export async function installSandboxAssets(sandbox: SandboxRuntime) {
  await sandbox.exec("mkdir -p /workspace/services/unyoh-api /workspace/services/fake-db /workspace/services/batch /workspace/bin /workspace/logs /workspace/run");
  for (const asset of assets) {
    await sandbox.writeFile(asset.path, asset.content);
  }
}
