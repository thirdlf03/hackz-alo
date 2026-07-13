import http from 'node:http';
import net from 'node:net';
import {appendFile, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  appendTrafficSample,
  readLogVolume,
  readServiceMetrics,
  readSystemMetrics,
  readTrafficMetrics,
} from '../metrics/collector.mjs';
import {ensureApiConfig, readApiConfig} from './config.mjs';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const DB_PING_TIMEOUT_MS = 400;
const LOG_QUOTA_UNHEALTHY_PERCENT = 90;
const HEALTH_LOG_THROTTLE_MS = 10_000;

const healthLogState = new Map();

export async function prepareWorkspace(workspace = DEFAULT_WORKSPACE) {
  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  await mkdir(path.join(workspace, 'run'), {recursive: true});
  await ensureApiConfig(workspace);
}

export function createYamabikoApiServer(options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  const server = http.createServer(async (req, res) => {
    const startedAt = performance.now();
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`
    );
    let status = 404;
    let payload = {error: 'not_found'};

    try {
      if (url.pathname === '/health') {
        const health = await getHealth(workspace);
        status = health.ok ? 200 : 500;
        payload = health;
      } else if (url.pathname === '/orders') {
        const health = await getHealth(workspace);
        if (health.ok) {
          status = 200;
          payload = {orders: [{id: 'ord_001', amount: 1200}]};
        } else {
          status = 500;
          payload = {error: health.reason};
        }
      } else if (url.pathname === '/metrics') {
        status = 200;
        payload = await getMetrics(workspace);
      }
    } catch {
      status = 500;
      payload = {error: 'internal_error'};
    }

    const durationMs = Math.round(performance.now() - startedAt);
    await appendTrafficSample(workspace, status, durationMs);
    await appendAccessLog(workspace, req.method ?? 'GET', url.pathname, status);
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(payload));
  });

  return server;
}

async function appendAccessLog(workspace, method, pathname, status) {
  try {
    await mkdir(path.join(workspace, 'logs'), {recursive: true});
    await appendFile(
      path.join(workspace, 'logs', 'access.log'),
      `${new Date().toISOString()} ${method} ${pathname} ${status}\n`
    );
  } catch (error) {
    console.error(`failed to append access log: ${error.message}`);
  }
}

/**
 * Live TCP ping against the configured database. The connection genuinely
 * fails (refused / timeout / pool rejection), so health reflects real state
 * instead of marker files.
 */
export function pingDb(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 15432;
  const timeoutMs = options.timeoutMs ?? DB_PING_TIMEOUT_MS;
  const clientName = options.clientName ?? 'yamabiko-api';

  return new Promise((resolve) => {
    const socket = net.createConnection({host, port});
    let buffer = '';
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(`app ${clientName}\nping\n`);
    });
    socket.on('data', (chunk) => {
      buffer += String(chunk);
      if (buffer.includes('too many connections')) {
        done({
          ok: false,
          reason: `too many connections at ${host}:${String(port)} (pool saturated)`,
        });
      } else if (buffer.includes('pong')) {
        done({ok: true});
      }
    });
    socket.once('timeout', () => {
      done({ok: false, reason: `connect ETIMEDOUT ${host}:${String(port)}`});
    });
    socket.once('error', (error) => {
      done({
        ok: false,
        reason: `connect ${error.code ?? 'ERROR'} ${host}:${String(port)}`,
      });
    });
  });
}

export async function getHealth(workspace = DEFAULT_WORKSPACE) {
  const configResult = await readApiConfig(workspace);
  if (!configResult.ok) {
    return await reportHealth(workspace, {
      service: 'yamabiko-api',
      version: 'unknown',
      ok: false,
      reason: `config: ${configResult.error}`,
    });
  }
  const config = configResult.config;
  const base = {service: config.service, version: config.version};

  const db = await pingDb({host: config.dbHost, port: config.dbPort});
  if (!db.ok) {
    return await reportHealth(workspace, {
      ...base,
      ok: false,
      reason: `db: ${db.reason}`,
    });
  }

  const logs = await readLogVolume(workspace, config.logQuotaBytes);
  if (logs.percent >= LOG_QUOTA_UNHEALTHY_PERCENT) {
    const usedMb = Math.round(logs.bytes / (1024 * 1024));
    const quotaMb = Math.round(config.logQuotaBytes / (1024 * 1024));
    return await reportHealth(workspace, {
      ...base,
      ok: false,
      reason: `logs: volume at ${String(logs.percent)}% of quota (${String(usedMb)}MB/${String(quotaMb)}MB) - writes will hit ENOSPC`,
    });
  }

  return await reportHealth(workspace, {...base, ok: true});
}

async function reportHealth(workspace, health) {
  const state = healthLogState.get(workspace) ?? {at: 0, reason: undefined};
  const now = Date.now();
  const changed = health.reason !== state.reason;
  const throttled = now - state.at < HEALTH_LOG_THROTTLE_MS;
  if (changed || !throttled) {
    healthLogState.set(workspace, {at: now, reason: health.reason});
    const line = health.ok
      ? state.reason === undefined
        ? undefined
        : 'health check ok (recovered)\n'
      : `health check failed: ${health.reason}\n`;
    if (line && (changed || !health.ok)) {
      try {
        await mkdir(path.join(workspace, 'logs'), {recursive: true});
        await appendFile(path.join(workspace, 'logs', 'app.log'), line);
      } catch {
        // logging must never break health reporting
      }
    }
  }
  return health;
}

export async function getMetrics(workspace = DEFAULT_WORKSPACE, tracker) {
  const [system, service, traffic] = await Promise.all([
    readSystemMetrics(workspace),
    readServiceMetrics(workspace),
    tracker
      ? Promise.resolve(tracker.snapshot())
      : readTrafficMetrics(workspace, undefined, {probe: false}),
  ]);

  let appLogTail = '';
  try {
    const appLog = await readFile(
      path.join(workspace, 'logs', 'app.log'),
      'utf8'
    );
    appLogTail = appLog.split('\n').slice(-5).join('\n');
  } catch {
    appLogTail = '';
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
    appLogTail,
  };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${value}`);
  }
  return port;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const port = parsePort(process.env.PORT ?? 8080);
  await prepareWorkspace(DEFAULT_WORKSPACE);
  const server = createYamabikoApiServer({workspace: DEFAULT_WORKSPACE});
  server.listen(port, () => {
    console.log(`yamabiko-api listening on ${port}`);
  });
}
