#!/usr/bin/env node
// 月次売上レポートバッチ。DB接続を解放しないバグがあり、プールを食い潰す。
// fake-db を再起動しても数秒で再接続して再び飽和させるため、
// 根本対処はこのプロセスを止めること(kill / pkill -f report-batch)。
import net from 'node:net';
import {appendFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const DB_HOST = process.env.FAKE_DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.FAKE_DB_PORT ?? 15432);
const RECONNECT_DELAY_MS = 5_000;

export function startConnectionHog(options = {}) {
  const target = options.target ?? Number(options.count ?? 40);
  const host = options.host ?? DB_HOST;
  const port = options.port ?? DB_PORT;
  const sockets = new Set();
  const pendingSockets = new Set();
  let stopped = false;
  let refillTimer;

  function openOne() {
    if (stopped || sockets.size + pendingSockets.size >= target) return;
    const socket = net.createConnection({host, port});
    pendingSockets.add(socket);
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      if (!pendingSockets.delete(socket)) return;
      sockets.add(socket);
      socket.write('app report-batch\nselect 1\n');
      fill();
    });
    const drop = () => {
      const wasPending = pendingSockets.delete(socket);
      const wasConnected = sockets.delete(socket);
      if (!wasPending && !wasConnected) return;
      socket.destroy();
      scheduleRefill();
    };
    socket.once('error', drop);
    socket.once('close', drop);
    socket.on('data', () => {
      // hold the connection open; results are never consumed (the bug)
    });
  }

  function fill() {
    while (!stopped && sockets.size + pendingSockets.size < target) {
      openOne();
    }
  }

  function scheduleRefill() {
    if (stopped || refillTimer !== undefined) return;
    refillTimer = setTimeout(() => {
      refillTimer = undefined;
      fill();
    }, RECONNECT_DELAY_MS);
  }

  fill();

  return {
    size: () => sockets.size,
    stop: () => {
      stopped = true;
      if (refillTimer !== undefined) clearTimeout(refillTimer);
      for (const socket of [...sockets, ...pendingSockets]) {
        socket.destroy();
      }
      sockets.clear();
      pendingSockets.clear();
    },
  };
}

async function appendBatchLog(workspace, line) {
  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  await appendFile(path.join(workspace, 'logs', 'batch.log'), line);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const count = Number(process.argv[2] ?? 40);
  const workspace = DEFAULT_WORKSPACE;
  await appendBatchLog(
    workspace,
    `${new Date().toISOString()} report-batch: monthly aggregation started\n`
  );
  const hog = startConnectionHog({count});
  const shutdown = async () => {
    hog.stop();
    await appendBatchLog(
      workspace,
      `${new Date().toISOString()} report-batch: terminated\n`
    );
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  // keep the event loop alive while holding connections
  setInterval(() => {}, 60_000);
}
