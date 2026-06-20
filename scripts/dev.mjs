import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const dockerBin = "/Applications/Docker.app/Contents/Resources/bin";
const env = {
  ...process.env,
  PATH: existsSync(dockerBin)
    ? `${dockerBin}:${process.env.PATH ?? ""}`
    : process.env.PATH
};

const processes = [
  {
    name: "worker",
    command: "npm",
    args: ["--workspace", "apps/worker", "run", "dev"]
  },
  {
    name: "web",
    command: "npm",
    args: ["--workspace", "apps/web", "run", "dev"]
  }
];

let shuttingDown = false;
const children = [];

for (const entry of processes) {
  const child = spawn(entry.command, entry.args, {
    env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  pipeWithPrefix(entry.name, child.stdout);
  pipeWithPrefix(entry.name, child.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${entry.name}] exited with ${signal ?? code}`);
    shutdown(code === null ? 1 : code);
  });

  children.push(child);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

function pipeWithPrefix(name, stream) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) console.log(`[${name}] ${line}`);
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) console.log(`[${name}] ${pending}`);
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 500).unref();
}
