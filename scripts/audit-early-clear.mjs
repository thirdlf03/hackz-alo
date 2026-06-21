#!/usr/bin/env node
/**
 * Static audit: which scenarios would allow early clear at game start
 * (before triggers) based on success conditions matching initial sandbox state.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_DIR = path.join(ROOT, "packages/scenarios/data");

/** Initial sandbox markers/files that are absent at session start (runtime clears api.down etc.). */
const INITIAL_ABSENT_MARKERS = new Set([
  "/workspace/run/api.down",
  "/workspace/run/deploy.json",
  "/workspace/run/db.pool.exhausted",
  "/workspace/run/monitor.blind.json",
  "/workspace/run/alert.spam.json",
  "/workspace/run/runbook.gaslight.json",
  "/workspace/run/janitor.power.pulled",
  "/workspace/run/network.jumprope",
  "/workspace/run/hosts.override",
  "/workspace/run/keyboard.spill",
  "/workspace/run/terminal.noise"
]);

/** Conditions that pass in a healthy initial session (before any trigger). */
function conditionPassesAtStart(condition) {
  switch (condition.type) {
    case "http_status":
      return condition.url === "http://localhost:8080/health" && condition.status === 200;
    case "process_running":
      return condition.processId === "api";
    case "disk_usage_below":
      return true;
    case "marker_absent":
      return INITIAL_ABSENT_MARKERS.has(condition.path);
    case "log_absent":
      return condition.path === "/workspace/logs/batch.log" && condition.pattern === "うんともすんとも";
    case "unlang_batch_ok":
      return true;
    default:
      return false;
  }
}

async function main() {
  const names = (await readdir(SCENARIO_DIR)).filter((name) => name.endsWith(".json")).sort();
  const scenarios = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(path.join(SCENARIO_DIR, name), "utf8")))
  );

  console.log("=== Early clear audit (static, pre-trigger sandbox state) ===\n");

  const vulnerableAtStart = [];
  const multiTriggerRisks = [];

  for (const scenario of scenarios) {
    const allPassAtStart = scenario.successConditions.every(conditionPassesAtStart);
    const triggerCount = scenario.triggers.length;
    const latestTriggerMs = Math.max(...scenario.triggers.map((trigger) => trigger.atMs), 0);

    if (allPassAtStart) {
      vulnerableAtStart.push({
        id: scenario.id,
        title: scenario.title,
        triggers: triggerCount,
        latestTriggerMs
      });
    }

    if (triggerCount > 1) {
      multiTriggerRisks.push({
        id: scenario.id,
        title: scenario.title,
        triggers: scenario.triggers.map((trigger) => `${trigger.id}@${trigger.atMs}ms`),
        partialClearRisk:
          "First trigger may only create removable markers while later triggers carry the real fault"
      });
    }
  }

  console.log("Scenarios whose success conditions all match INITIAL state:");
  if (vulnerableAtStart.length === 0) {
    console.log("  (none)");
  } else {
    for (const item of vulnerableAtStart) {
      console.log(
        `  - ${item.id} (${item.title}): ${item.triggers} trigger(s), last at ${item.latestTriggerMs}ms`
      );
    }
  }

  console.log("\nMulti-trigger scenarios (partial-trigger clear risk if only first trigger required):");
  for (const item of multiTriggerRisks) {
    console.log(`  - ${item.id} (${item.title})`);
    for (const trigger of item.triggers) {
      console.log(`      ${trigger}`);
    }
  }

  console.log("\nMitigation: canDeclareRecovery should require ALL triggers fired.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
