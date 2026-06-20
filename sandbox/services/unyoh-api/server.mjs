import http from "node:http";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RequestMetricsTracker,
  readServiceMetrics,
  readSystemMetrics
} from "../metrics/collector.mjs";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";

export async function prepareWorkspace(workspace = DEFAULT_WORKSPACE) {
  await mkdir(path.join(workspace, "logs"), { recursive: true });
  await mkdir(path.join(workspace, "run"), { recursive: true });
}

export function createUnyohApiServer(options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const tracker = options.tracker ?? new RequestMetricsTracker();
  const enableProbe = options.enableProbe ?? true;

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
        payload = await getMetrics(workspace, tracker);
      }
    } catch {
      status = 500;
      payload = { error: "internal_error" };
    }

    const durationMs = Math.round(performance.now() - startedAt);
    tracker.record(status, durationMs);
    await appendAccessLog(workspace, req.method ?? "GET", url.pathname, status);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  });

  if (enableProbe) {
    server.on("listening", () => {
      const port = server.address()?.port;
      if (!port) return;
      const probe = async () => {
        for (const pathname of ["/health", "/orders"]) {
          const startedAt = performance.now();
          try {
            const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
            tracker.record(response.status, Math.round(performance.now() - startedAt));
          } catch {
            tracker.record(500, Math.round(performance.now() - startedAt));
          }
        }
      };
      const timer = setInterval(() => {
        void probe();
      }, 2000);
      timer.unref();
    });
  }

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
  const downMarker = path.join(workspace, "run", "api.down");
  if (existsSync(downMarker)) {
    return { ok: false, reason: "process marker says api is down" };
  }
  const debugLog = path.join(logDir, "debug.log");
  if (existsSync(debugLog)) {
    const info = await stat(debugLog);
    if (info.size > 50 * 1024 * 1024) {
      return { ok: false, reason: "disk pressure from debug.log" };
    }
  }
  return { ok: true };
}

export async function getMetrics(workspace = DEFAULT_WORKSPACE, tracker = new RequestMetricsTracker()) {
  const [system, service, traffic] = await Promise.all([
    readSystemMetrics(workspace),
    readServiceMetrics(workspace),
    Promise.resolve(tracker.snapshot())
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
