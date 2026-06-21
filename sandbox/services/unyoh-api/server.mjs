import http from "node:http";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendTrafficSample,
  readServiceMetrics,
  readSystemMetrics,
  readTrafficMetrics
} from "../metrics/collector.mjs";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";

export async function prepareWorkspace(workspace = DEFAULT_WORKSPACE) {
  await mkdir(path.join(workspace, "logs"), { recursive: true });
  await mkdir(path.join(workspace, "run"), { recursive: true });
}

export function createUnyohApiServer(options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  const server = http.createServer(async (req, res) => {
    const startedAt = performance.now();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let status = 404;
    let payload = { error: "not_found" };

    try {
      if (url.pathname === "/health") {
        const health = await getHealth(workspace);
        status = health.ok ? 200 : 500;
        payload = health;
      } else if (url.pathname === "/orders") {
        const health = await getHealth(workspace);
        if (health.ok) {
          status = 200;
          payload = { orders: [{ id: "ord_001", amount: 1200 }] };
        } else {
          status = 500;
          payload = { error: health.reason };
        }
      } else if (url.pathname === "/metrics") {
        status = 200;
        payload = await getMetrics(workspace);
      }
    } catch {
      status = 500;
      payload = { error: "internal_error" };
    }

    const durationMs = Math.round(performance.now() - startedAt);
    await appendTrafficSample(workspace, status, durationMs);
    await appendAccessLog(workspace, req.method ?? "GET", url.pathname, status);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  });

  return server;
}

async function appendAccessLog(workspace, method, pathname, status) {
  try {
    await mkdir(path.join(workspace, "logs"), { recursive: true });
    await appendFile(
      path.join(workspace, "logs", "access.log"),
      `${new Date().toISOString()} ${method} ${pathname} ${status}\n`
    );
  } catch (error) {
    console.error(`failed to append access log: ${error.message}`);
  }
}

export async function getHealth(workspace = DEFAULT_WORKSPACE) {
  const logDir = path.join(workspace, "logs");
  const runDir = path.join(workspace, "run");
  const downMarker = path.join(runDir, "api.down");
  if (existsSync(downMarker)) {
    return { ok: false, reason: "process marker says api is down" };
  }
  if (existsSync(path.join(runDir, "janitor.power.pulled"))) {
    return { ok: false, reason: "janitor power pull marker active" };
  }
  if (existsSync(path.join(runDir, "network.jumprope")) || existsSync(path.join(runDir, "hosts.override"))) {
    return { ok: false, reason: "network path blocked by cable or hosts override" };
  }
  const deployPath = path.join(runDir, "deploy.json");
  if (existsSync(deployPath)) {
    try {
      const deploy = JSON.parse(await readFile(deployPath, "utf8"));
      if (deploy.healthPath && deploy.healthPath !== "/health") {
        return { ok: false, reason: "bad deploy: health probe misconfigured" };
      }
    } catch {
      return { ok: false, reason: "bad deploy: unreadable deploy.json" };
    }
  }
  if (existsSync(path.join(runDir, "db.pool.exhausted"))) {
    return { ok: false, reason: "db connection pool exhausted" };
  }
  const debugLog = path.join(logDir, "debug.log");
  if (existsSync(debugLog)) {
    const info = await stat(debugLog);
    if (info.size > 50 * 1024 * 1024) {
      return { ok: false, reason: "disk pressure from debug.log" };
    }
  }
  const accessLog = path.join(logDir, "access.log");
  if (existsSync(accessLog)) {
    const info = await stat(accessLog);
    if (info.size > 100 * 1024 * 1024) {
      return { ok: false, reason: "disk pressure from access.log" };
    }
  }
  const system = await readSystemMetrics(workspace);
  if (system.disk > 85) {
    return { ok: false, reason: `disk usage at ${system.disk}%` };
  }
  return { ok: true };
}

export async function getMetrics(workspace = DEFAULT_WORKSPACE, tracker) {
  const [system, service, traffic] = await Promise.all([
    readSystemMetrics(workspace),
    readServiceMetrics(workspace),
    tracker ? Promise.resolve(tracker.snapshot()) : readTrafficMetrics(workspace, undefined, { probe: false })
  ]);

  let appLogTail = "";
  try {
    const appLog = await readFile(path.join(workspace, "logs", "app.log"), "utf8");
    appLogTail = appLog.split("\n").slice(-5).join("\n");
  } catch {
    appLogTail = "";
  }

  return {
    at: Date.now(),
    cpu: system.cpu,
    memory: system.memory,
    disk: system.disk,
    http5xxRate: traffic.http5xxRate,
    latencyP95Ms: traffic.latencyP95Ms,
    rps: traffic.rps,
    dbConnections: service.dbConnections,
    queueDepth: service.queueDepth,
    appLogTail
  };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${value}`);
  }
  return port;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = parsePort(process.env.PORT ?? 8080);
  await prepareWorkspace(DEFAULT_WORKSPACE);
  const server = createUnyohApiServer({ workspace: DEFAULT_WORKSPACE });
  server.listen(port, () => {
    console.log(`unyoh-api listening on ${port}`);
  });
}
