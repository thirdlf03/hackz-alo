import net from 'node:net';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export function createFakeDbServer(options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  let connections = 0;

  const server = net.createServer((socket) => {
    connections += 1;
    void writeStats(workspace, connections);

    socket.setEncoding('utf8');
    socket.write('fake-db ready\n');

    socket.on('data', (chunk) => {
      for (const input of chunk
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)) {
        const output = handleCommand(input);
        socket.write(output);
        if (output === 'bye\n') {
          socket.end();
          break;
        }
      }
    });

    const onClose = () => {
      connections = Math.max(0, connections - 1);
      void writeStats(workspace, connections);
    };

    socket.on('close', onClose);
    socket.on('end', onClose);
    socket.on('error', () => {
      socket.destroy();
    });
  });

  return server;
}

export function handleCommand(input) {
  const normalized = input.toLowerCase();
  if (normalized === 'ping') return 'pong\n';
  if (normalized === 'select 1' || normalized === 'select 1;') return 'row 1\n';
  if (normalized === 'quit' || normalized === 'exit') return 'bye\n';
  return `ok ${input}\n`;
}

async function writeStats(workspace, connections) {
  const runDir = path.join(workspace, 'run');
  await mkdir(runDir, {recursive: true});
  await writeFile(
    path.join(runDir, 'fake-db-stats.json'),
    `${JSON.stringify({connections, at: Date.now()})}\n`
  );
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid FAKE_DB_PORT: ${value}`);
  }
  return port;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const port = parsePort(process.env.FAKE_DB_PORT ?? 15432);
  const server = createFakeDbServer({
    workspace: process.env.WORKSPACE_DIR ?? DEFAULT_WORKSPACE,
  });
  server.listen(port, () => {
    console.log(`fake-db listening on ${port}`);
  });
}
