#!/usr/bin/env node
import { readServiceMetrics, readSystemMetrics, readTrafficMetrics } from "./collector.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? "/workspace";

export async function collectMetrics(workspace = DEFAULT_WORKSPACE) {
  const [system, service, traffic] = await Promise.all([
    readSystemMetrics(workspace),
    readServiceMetrics(workspace),
    readTrafficMetrics(workspace)
  ]);

  return {
    at: Date.now(),
    ...system,
    ...service,
    ...traffic
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.stdout.write(JSON.stringify(await collectMetrics()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
