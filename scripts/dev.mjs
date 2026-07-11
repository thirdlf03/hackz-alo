import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

const dockerBin = "/Applications/Docker.app/Contents/Resources/bin";
const env = {
  ...process.env,
  PATH: existsSync(dockerBin)
    ? `${dockerBin}:${process.env.PATH ?? ""}`
    : process.env.PATH
};
const workerArgs = ["--filter", "@incident/worker"];
if (env.INCIDENT_PERF || env.INCIDENT_DISABLE_TURNSTILE === "1") {
  workerArgs.push("exec", "wrangler", "dev");
  if (env.INCIDENT_PERF) {
    workerArgs.push("--var", `INCIDENT_PERF:${env.INCIDENT_PERF}`);
  }
  if (env.INCIDENT_DISABLE_TURNSTILE === "1") {
    // Clear worker secret AND web site key. Otherwise apps/web/.env.local's
    // VITE_TURNSTILE_SITE_KEY still forces a client-side challenge that fails
    // under Playwright (design/capture.mjs, e2e) even though the worker would
    // accept sessions without a token. Matches playwright.config.ts.
    workerArgs.push("--var", "TURNSTILE_SECRET_KEY:");
    env.VITE_TURNSTILE_SITE_KEY = "";
  }
} else {
  workerArgs.push("run", "dev");
}

const processes = [
  {
    name: "worker",
    command: "pnpm",
    args: workerArgs
  },
  {
    name: "web",
    command: "pnpm",
    args: ["--filter", "@incident/web", "run", "dev"]
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
  cleanupSandboxContainers();
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 500).unref();
}

function cleanupSandboxContainers() {
  try {
    const ids = execSync('docker ps -aq --filter "name=workerd-incident-training-worker-Sandbox"', {
      env,
      encoding: "utf8"
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (ids.length === 0) return;
    execSync(`docker rm -f ${ids.join(" ")}`, { env, stdio: "ignore" });
    console.log(`[dev] removed ${ids.length} sandbox container(s)`);
  } catch {
    // Docker may be unavailable; ignore.
  }
}
