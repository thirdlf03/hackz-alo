#!/usr/bin/env node
/**
 * Verifies every scenario can reach a resolved state when runbook-style fixes are applied.
 * Requires: pnpm run dev (worker on :8787, Docker for sandbox)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.INCIDENT_API_URL ?? "http://127.0.0.1:8787";
const GAME_SPEED = 8;
const COMMAND_DELAY_MS = 2500;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_DIR = path.join(ROOT, "packages/scenarios/data");

const SALES_KDM_FIXED = `やまびこ帳 売上集計バッチ
よぶ x = 100
よぶ y = こだま
よぶ z = x わる y
かえす z
`;

/** @type {Record<string, { commands?: string[], files?: Array<{ path: string, content: string }>, waitGameMs: number }>} */
const FIXES = {
  "process-stop-001": {
    waitGameMs: 30_000,
    commands: ["yamactl restart api"]
  },
  "disk-full-001": {
    waitGameMs: 60_000,
    commands: ["rm -f /workspace/logs/debug.log", "yamactl restart api"]
  },
  "hang-basics-001": {
    waitGameMs: 105_000,
    commands: ["yamactl restart api", "curl -s --max-time 5 localhost:8080/health"]
  },
  "config-rollback-001": {
    waitGameMs: 75_000,
    commands: [
      "cp /workspace/releases/yamabiko-api.previous.json /workspace/etc/yamabiko-api.json",
      "curl -s localhost:8080/health"
    ]
  },
  "alert-triage-001": {
    waitGameMs: 165_000,
    commands: ["pkill -f alert-flood-daemon.mjs", "yamactl restart api"]
  },
  "kodama-batch-001": {
    waitGameMs: 90_000,
    files: [{ path: "/workspace/services/batch/sales.kdm", content: SALES_KDM_FIXED }],
    commands: [
      "kodama run /workspace/services/batch/sales.kdm",
      ": > /workspace/logs/batch.log"
    ]
  },
  "db-pool-001": {
    waitGameMs: 60_000,
    commands: ["pkill -f report-batch.mjs", "curl -s localhost:8080/health"]
  },
  "bad-deploy-001": {
    waitGameMs: 45_000,
    commands: [
      "cp /workspace/releases/yamabiko-api.previous.json /workspace/etc/yamabiko-api.json",
      "curl -s localhost:8080/health"
    ]
  },
  "api-hang-001": {
    waitGameMs: 75_000,
    commands: ["yamactl restart api", "curl -s --max-time 5 localhost:8080/health"]
  },
  "port-conflict-001": {
    waitGameMs: 50_000,
    commands: ["pkill -f legacy-metrics-agent.mjs", "yamactl restart api"]
  },
  "log-bloat-001": {
    waitGameMs: 50_000,
    commands: ["rm -f /workspace/logs/access.log", "curl -s localhost:8080/health"]
  },
  "disk-restart-loop-001": {
    waitGameMs: 60_000,
    commands: ["rm -f /workspace/logs/debug.log", "yamactl restart api"]
  },
  "monitor-blind-001": {
    waitGameMs: 90_000,
    commands: ["yamactl restart monitor-agent", "yamactl restart api"]
  },
  "kodama-mystery-001": {
    waitGameMs: 90_000,
    files: [{ path: "/workspace/services/batch/sales.kdm", content: SALES_KDM_FIXED }],
    commands: [
      "kodama run /workspace/services/batch/sales.kdm",
      ": > /workspace/logs/batch.log"
    ]
  },
  "janitor-power-001": {
    waitGameMs: 60_000,
    commands: ["yamactl restart api"]
  },
  "cable-jumprope-001": {
    waitGameMs: 55_000,
    commands: ["yamactl restart fake-db", "curl -s localhost:8080/health"]
  },
  "keyboard-spill-001": {
    waitGameMs: 50_000,
    commands: ["pkill -f loadgen.mjs"]
  },
  "alert-spam-001": {
    waitGameMs: 120_000,
    commands: ["pkill -f alert-flood-daemon.mjs", "yamactl restart api"]
  },
  "runbook-gaslight-001": {
    waitGameMs: 40_000,
    commands: [
      "cp /workspace/docs/backups/service-recovery.md /workspace/docs/runbooks/service-recovery.md"
    ]
  },
  "chaotic-night-001": {
    waitGameMs: 105_000,
    commands: [
      "pkill -f alert-flood-daemon.mjs",
      "cp /workspace/docs/backups/service-recovery.md /workspace/docs/runbooks/service-recovery.md",
      "rm -f /workspace/logs/debug.log",
      "yamactl restart api"
    ]
  }
};

async function api(route, opts = {}, writeToken) {
  const authHeader = writeToken ? { authorization: `Bearer ${writeToken}` } : {};
  const res = await fetch(`${API}${route}`, {
    headers: { "content-type": "application/json", ...authHeader, ...(opts.headers ?? {}) },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${opts.method ?? "GET"} ${route} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectTerminal(sessionId, writeToken) {
  const wsUrl = new URL(`${API.replace(/^http/, "ws")}/api/sessions/${sessionId}/ws/terminal`);
  if (writeToken) wsUrl.searchParams.set("accessToken", writeToken);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("terminal ready timeout")), 45_000);
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data);
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(undefined);
      }
      if (message.type === "error") {
        clearTimeout(timer);
        reject(new Error(message.message ?? "terminal error"));
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("terminal websocket error"));
    });
  });
  return ws;
}

async function runCommands(sessionId, commands, writeToken) {
  if (commands.length === 0) return;
  const ws = await connectTerminal(sessionId, writeToken);
  try {
    for (const command of commands) {
      ws.send(new TextEncoder().encode(`${command}\n`));
      await sleep(COMMAND_DELAY_MS);
    }
  } finally {
    ws.close();
    await sleep(500);
  }
}

async function writeFiles(sessionId, files, writeToken) {
  for (const file of files ?? []) {
    await api(`/api/sessions/${sessionId}/file`, {
      method: "PUT",
      body: JSON.stringify({ path: file.path, content: file.content })
    }, writeToken);
  }
}

async function testEarlyResolveBlocked(scenario) {
  const created = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ scenarioId: scenario.id })
  });
  const sessionId = created.data.sessionId;
  const writeToken = created.data.writeToken;
  try {
    await api(`/api/sessions/${sessionId}/start`, { method: "POST", body: "{}" }, writeToken);
    const resolved = await api(`/api/sessions/${sessionId}/resolve`, { method: "POST", body: "{}" }, writeToken);
    return resolved.data.ok !== true;
  } finally {
    await api(`/api/sessions/${sessionId}`, { method: "DELETE" }, writeToken).catch(() => undefined);
  }
}

async function testScenario(scenario) {
  const fix = FIXES[scenario.id];
  if (!fix) throw new Error(`missing fix recipe for ${scenario.id}`);

  const created = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ scenarioId: scenario.id })
  });
  const sessionId = created.data.sessionId;
  const writeToken = created.data.writeToken;

  try {
    await api(`/api/sessions/${sessionId}/start`, { method: "POST", body: "{}" }, writeToken);
    await api(`/api/sessions/${sessionId}/clock`, {
      method: "POST",
      body: JSON.stringify({ speed: GAME_SPEED })
    }, writeToken);

    const waitWallMs = Math.ceil(fix.waitGameMs / GAME_SPEED) + 4_000;
    await sleep(waitWallMs);

    await writeFiles(sessionId, fix.files, writeToken);
    await runCommands(sessionId, fix.commands ?? [], writeToken);

    const resolved = await api(`/api/sessions/${sessionId}/resolve`, { method: "POST", body: "{}" }, writeToken);
    const failedChecks = (resolved.data.checks ?? []).filter((check) => !check.ok);
    return {
      id: scenario.id,
      title: scenario.title,
      difficulty: scenario.difficulty,
      ok: resolved.data.ok === true && failedChecks.length === 0,
      checks: resolved.data.checks,
      failedChecks
    };
  } finally {
    await api(`/api/sessions/${sessionId}`, { method: "DELETE" }, writeToken).catch(() => undefined);
  }
}

async function loadScenarios() {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(SCENARIO_DIR)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(path.join(SCENARIO_DIR, name), "utf8")))
  );
}

const scenarios = await loadScenarios();
const missing = scenarios.filter((scenario) => !FIXES[scenario.id]);
if (missing.length > 0) {
  console.error("Missing fix recipes:", missing.map((scenario) => scenario.id).join(", "));
  process.exit(1);
}

console.log(`Testing ${scenarios.length} scenarios against ${API} (speed=${GAME_SPEED})...\n`);

console.log("=== Immediate resolve should NOT clear ===");
let earlyGuardOk = true;
for (const scenario of scenarios) {
  process.stdout.write(`- ${scenario.id} ... `);
  try {
    const blocked = await testEarlyResolveBlocked(scenario);
    console.log(blocked ? "blocked (good)" : "STILL CLEARS (bad)");
    if (!blocked) earlyGuardOk = false;
  } catch (error) {
    console.log("ERROR");
    console.log(`  ${error instanceof Error ? error.message : error}`);
    earlyGuardOk = false;
  }
}
if (!earlyGuardOk) {
  console.error("\nImmediate resolve guard failed for one or more scenarios.");
  process.exit(1);
}

console.log("\n=== Runbook-style clear ===");
const results = [];
for (const scenario of scenarios) {
  process.stdout.write(`- ${scenario.difficulty} / ${scenario.title} ... `);
  try {
    const result = await testScenario(scenario);
    results.push(result);
    console.log(result.ok ? "CLEAR" : "FAIL");
    if (!result.ok) {
      console.log("  checks:", JSON.stringify(result.failedChecks, null, 2));
    }
  } catch (error) {
    results.push({
      id: scenario.id,
      title: scenario.title,
      difficulty: scenario.difficulty,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    console.log("ERROR");
    console.log(`  ${error instanceof Error ? error.message : error}`);
  }
}

const byDifficulty = {
  beginner: results.filter((result) => result.difficulty === "beginner"),
  intermediate: results.filter((result) => result.difficulty === "intermediate"),
  advanced: results.filter((result) => result.difficulty === "advanced")
};

console.log("\n=== Summary ===");
for (const [difficulty, items] of Object.entries(byDifficulty)) {
  const cleared = items.filter((item) => item.ok).length;
  console.log(`${difficulty}: ${cleared}/${items.length} cleared`);
}

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.log("\nFailed scenarios:");
  for (const failure of failures) {
    console.log(`- ${failure.id} (${failure.title})`);
    if (failure.error) console.log(`  error: ${failure.error}`);
    if (failure.failedChecks?.length) {
      console.log(`  checks: ${JSON.stringify(failure.failedChecks)}`);
    }
  }
  process.exit(1);
}

console.log("\nAll scenarios cleared successfully.");

const restartOnlyBlocked = [
  "cable-jumprope-001",
  "bad-deploy-001",
  "db-pool-001",
  "disk-full-001",
  "log-bloat-001",
  "alert-spam-001",
  "chaotic-night-001",
  "monitor-blind-001"
];

console.log("\n=== Restart-only should NOT clear ===");
let restartGuardOk = true;
for (const scenarioId of restartOnlyBlocked) {
  const scenario = scenarios.find((item) => item.id === scenarioId);
  if (!scenario) continue;
  const fix = FIXES[scenarioId];
  const created = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ scenarioId })
  });
  const sessionId = created.data.sessionId;
  const writeToken = created.data.writeToken;
  let blocked = false;
  try {
    await api(`/api/sessions/${sessionId}/start`, { method: "POST", body: "{}" }, writeToken);
    await api(`/api/sessions/${sessionId}/clock`, {
      method: "POST",
      body: JSON.stringify({ speed: GAME_SPEED })
    }, writeToken);
    await sleep(Math.ceil((fix.waitGameMs ?? 60_000) / GAME_SPEED) + 4000);
    await runCommands(sessionId, ["yamactl restart api"], writeToken);
    const resolved = await api(`/api/sessions/${sessionId}/resolve`, { method: "POST", body: "{}" }, writeToken);
    blocked = resolved.data.ok !== true;
  } catch {
    blocked = true;
  } finally {
    await api(`/api/sessions/${sessionId}`, { method: "DELETE" }, writeToken).catch(() => undefined);
  }
  console.log(`- ${scenarioId}: ${blocked ? "blocked (good)" : "STILL CLEARS (bad)"}`);
  if (!blocked) restartGuardOk = false;
}

if (!restartGuardOk) {
  console.error("\nRestart-only guard failed for one or more scenarios.");
  process.exit(1);
}
