import net from 'node:net';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const DEFAULT_MAX_CONNECTIONS = 40;

export function createFakeDbServer(options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const clients = new Map();
  let rejectedTotal = 0;

  const server = net.createServer((socket) => {
    if (clients.size >= maxConnections) {
      rejectedTotal += 1;
      void writeStats(workspace, clients, maxConnections, rejectedTotal);
      socket.write('error: too many connections\n');
      socket.destroy();
      return;
    }

    clients.set(socket, {name: 'unknown', since: Date.now()});
    void writeStats(workspace, clients, maxConnections, rejectedTotal);

    socket.setEncoding('utf8');
    socket.write('fake-db ready\n');

    socket.on('data', (chunk) => {
      for (const input of chunk
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)) {
        const appMatch = input.match(/^app\s+(\S+)$/u);
        if (appMatch) {
          const client = clients.get(socket);
          if (client) client.name = appMatch[1];
          void writeStats(workspace, clients, maxConnections, rejectedTotal);
          socket.write(`ok app ${appMatch[1]}\n`);
          continue;
        }
        const output = handleCommand(input);
        socket.write(output);
        if (output === 'bye\n') {
          socket.end();
          break;
        }
      }
    });

    const onClose = () => {
      if (clients.delete(socket)) {
        void writeStats(workspace, clients, maxConnections, rejectedTotal);
      }
    };

    socket.on('close', onClose);
    socket.on('end', onClose);
    socket.on('error', () => {
      socket.destroy();
    });
  });

  // net.Server has no closeAllConnections; expose one so shutdown never
  // waits on clients that hold connections open (e.g. the leaky batch)
  server.closeAllConnections = () => {
    for (const socket of clients.keys()) socket.destroy();
  };

  return server;
}

export function handleCommand(input) {
  const normalized = input.toLowerCase();
  if (normalized === 'ping') return 'pong\n';
  if (normalized === 'select 1' || normalized === 'select 1;') return 'row 1\n';
  if (normalized === 'quit' || normalized === 'exit') return 'bye\n';
  return `ok ${input}\n`;
}

export function summarizeClients(clients) {
  const byName = {};
  for (const {name} of clients.values()) {
    byName[name] = (byName[name] ?? 0) + 1;
  }
  return byName;
}

async function writeStats(workspace, clients, maxConnections, rejectedTotal) {
  const runDir = path.join(workspace, 'run');
  await mkdir(runDir, {recursive: true});
  await writeFile(
    path.join(runDir, 'fake-db-stats.json'),
    `${JSON.stringify({
      connections: clients.size,
      maxConnections,
      clients: summarizeClients(clients),
      rejectedTotal,
      at: Date.now(),
    })}\n`
  );
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid FAKE_DB_PORT: ${value}`);
  }
  return port;
}

function parseMaxConnections(value) {
  if (value === undefined) return DEFAULT_MAX_CONNECTIONS;
  const max = Number(value);
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`invalid FAKE_DB_MAX_CONNECTIONS: ${value}`);
  }
  return max;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const port = parsePort(process.env.FAKE_DB_PORT ?? 15432);
  const server = createFakeDbServer({
    workspace: process.env.WORKSPACE_DIR ?? DEFAULT_WORKSPACE,
    maxConnections: parseMaxConnections(process.env.FAKE_DB_MAX_CONNECTIONS),
  });
  server.listen(port, () => {
    console.log(`fake-db listening on ${port}`);
  });
}
