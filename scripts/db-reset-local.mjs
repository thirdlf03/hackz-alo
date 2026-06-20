#!/usr/bin/env node
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/worker");
const d1StateDir = path.join(workerDir, ".wrangler/state/v3/d1");

if (existsSync(d1StateDir)) {
  rmSync(d1StateDir, { recursive: true, force: true });
  console.log("removed local D1 state:", d1StateDir);
}

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "incident-training", "--local"],
  { cwd: workerDir, stdio: "inherit", env: process.env }
);

if (result.status !== 0) process.exit(result.status ?? 1);
console.log("local D1 migrations applied");
