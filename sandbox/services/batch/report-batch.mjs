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
  const target = options.target ?? Number(options.count ?? 38);
  const host = options.host ?? DB_HOST;
  const port = options.port ?? DB_PORT;
  const sockets = new Set();
  let stopped = false;

  function openOne() {
    if (stopped || sockets.size >= target) return;
    const socket = net.createConnection({host, port});
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      sockets.add(socket);
      socket.write('app report-batch\nselect 1\n');
      openOne();
    });
    const drop = () => {
      sockets.delete(socket);
      socket.destroy();
      if (!stopped) setTimeout(openOne, RECONNECT_DELAY_MS);
    };
    socket.once('error', drop);
    socket.once('close', drop);
    socket.on('data', () => {
      // hold the connection open; results are never consumed (the bug)
    });
  }

  for (let index = 0; index < target; index += 1) openOne();

  return {
    size: () => sockets.size,
    stop: () => {
      stopped = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
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
  const count = Number(process.argv[2] ?? 38);
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
