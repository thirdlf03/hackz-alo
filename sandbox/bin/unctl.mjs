#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, open, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";
const USAGE = "usage: unctl <status|restart|stop> api";

export async function runUnctl(command, service, options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  if (!["status", "restart", "stop"].includes(command) || service !== "api") {
    throw usageError();
  }

  const runDir = path.join(workspace, "run");
  const downMarker = path.join(runDir, "api.down");
  await mkdir(runDir, { recursive: true });

  if (command === "status") {
    return (await exists(downMarker)) ? "api stopped" : "api running";
  }

  if (command === "restart") {
    await rm(downMarker, { force: true });
    await appendAppLog(workspace, "api restarted by unctl\n");
    if (options.ensureProcess) {
      await ensureApiProcess(workspace);
    }
    return "api restarted";
  }

  await writeFile(downMarker, new Date().toISOString());
  await appendAppLog(workspace, "api stopped by unctl\n");
  return "api stopped";
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function usageError() {
  const error = new Error(USAGE);
  error.code = "USAGE";
  return error;
}

async function appendAppLog(workspace, line) {
  await mkdir(path.join(workspace, "logs"), { recursive: true });
  await appendFile(path.join(workspace, "logs", "app.log"), line);
}

async function ensureApiProcess(workspace) {
  if (await canConnect(8080)) return;

  await mkdir(path.join(workspace, "logs"), { recursive: true });
  const stdout = await open(path.join(workspace, "logs", "unyoh-api.out.log"), "a");
  const stderr = await open(path.join(workspace, "logs", "unyoh-api.err.log"), "a");
  const child = spawn("node", [path.join(workspace, "services", "unyoh-api", "server.mjs")], {
    cwd: workspace,
    detached: true,
    env: { ...process.env, PORT: "8080", WORKSPACE_DIR: workspace },
    stdio: ["ignore", stdout.fd, stderr.fd]
  });
  child.unref();
  stdout.close().catch(() => {});
  stderr.close().catch(() => {});
  if (!(await waitForPort(8080, 3000))) {
    throw new Error("api restart requested but port 8080 did not open");
  }
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, service] = process.argv.slice(2);
  try {
    process.stdout.write(`${await runUnctl(command, service, { ensureProcess: true })}\n`);
  } catch (error) {
    console.error(error.code === "USAGE" ? USAGE : error.message);
    process.exit(1);
  }
}
