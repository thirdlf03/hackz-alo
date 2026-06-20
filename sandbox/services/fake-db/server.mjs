import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createFakeDbServer() {
  return net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("fake-db ready\n");

    socket.on("data", (chunk) => {
      for (const input of chunk.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)) {
        const output = handleCommand(input);
        socket.write(output);
        if (output === "bye\n") {
          socket.end();
          break;
        }
      }
    });

    socket.on("error", () => {
      socket.destroy();
    });
  });
}

export function handleCommand(input) {
  const normalized = input.toLowerCase();
  if (normalized === "ping") return "pong\n";
  if (normalized === "select 1" || normalized === "select 1;") return "row 1\n";
  if (normalized === "quit" || normalized === "exit") return "bye\n";
  return `ok ${input}\n`;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid FAKE_DB_PORT: ${value}`);
  }
  return port;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = parsePort(process.env.FAKE_DB_PORT ?? 15432);
  const server = createFakeDbServer();
  server.listen(port, () => {
    console.log(`fake-db listening on ${port}`);
  });
}
