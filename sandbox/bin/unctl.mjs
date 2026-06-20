#!/usr/bin/env node
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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
    return "api restarted";
  }

  await writeFile(downMarker, new Date().toISOString());
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, service] = process.argv.slice(2);
  try {
    console.log(await runUnctl(command, service));
  } catch (error) {
    console.error(error.code === "USAGE" ? USAGE : error.message);
    process.exit(1);
  }
}
