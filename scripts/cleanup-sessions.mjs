#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/worker");
const wranglerToml = path.join(workerDir, "wrangler.toml");

const RUNNING_MAX_WALL_MINUTES = 30;
const STALE_CREATED_MAX_MINUTES = 20;
const LOCAL_WORKER_URL = "http://127.0.0.1:8787";

function usage() {
  console.log(`Usage: pnpm run cleanup:sessions -- [options]

放置された play session / Sandbox コンテナを掃除します。
各セッションに timeout API を送り、Sandbox を destroy します。

Options:
  --remote          本番 D1 + デプロイ済み Worker（デフォルト）
  --local           ローカル D1 + wrangler dev (127.0.0.1:8787)
  --all             running / briefing / created をすべて掃除（デモ向け）
  --stale           一定時間以上放置されたものだけ掃除（Cron と同じ基準、デフォルト）
  --url <origin>    Worker の URL（例: https://incident-training-worker.example.workers.dev）
  --dry-run         対象を表示するだけで API は呼ばない
  -h, --help        このヘルプ

環境変数:
  INCIDENT_WORKER_URL   --url の代わりに Worker URL を指定

Examples:
  pnpm run cleanup:sessions -- --all
  pnpm run cleanup:sessions -- --all --url https://incident-training-worker.naokimiura15.workers.dev
  INCIDENT_WORKER_URL=https://... pnpm run cleanup:sessions -- --stale
  pnpm run cleanup:sessions -- --local --all
`);
}

function parseArgs(argv) {
  const options = {
    remote: true,
    all: false,
    stale: true,
    dryRun: false,
    url: process.env.INCIDENT_WORKER_URL?.replace(/\/$/, "")
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--remote") {
      options.remote = true;
      continue;
    }
    if (arg === "--local") {
      options.remote = false;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      options.stale = false;
      continue;
    }
    if (arg === "--stale") {
      options.all = false;
      options.stale = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--url") {
      const value = argv[++i];
      if (!value) {
        console.error("--url requires a value");
        process.exit(1);
      }
      options.url = value.replace(/\/$/, "");
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    usage();
    process.exit(1);
  }

  return options;
}

function readWorkerName() {
  const content = readFileSync(wranglerToml, "utf8");
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("could not read worker name from wrangler.toml");
  return match[1];
}

function runWrangler(args) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: workerDir,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    console.error(detail || `wrangler ${args.join(" ")} failed`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function resolveWorkerUrl(options) {
  if (options.url) return options.url;
  if (!options.remote) return LOCAL_WORKER_URL;

  const dryRunDir = path.join(workerDir, ".wrangler", "cleanup-dry-run");
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "deploy", "--dry-run", "--outdir", dryRunDir],
    { cwd: workerDir, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] }
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i);
  if (match) return match[0];

  console.error("Worker URL を特定できませんでした。");
  console.error("INCIDENT_WORKER_URL または --url を指定してください。");
  process.exit(1);
}

function querySessions(options) {
  const sql = options.all ? listAllSql() : listStaleSql();
  const args = ["d1", "execute", "incident-training", "--command", sql, "--json"];
  if (options.remote) args.push("--remote");
  else args.push("--local");

  const stdout = runWrangler(args);
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    console.error("D1 query returned non-JSON output:");
    console.error(stdout);
    process.exit(1);
  }

  const rows = payload[0]?.results ?? [];
  return rows
    .map((row) => ({
      id: String(row.id ?? ""),
      status: String(row.status ?? ""),
      createdAt: row.created_at ?? null,
      startedAt: row.started_at ?? null
    }))
    .filter((row) => row.id);
}

function listAllSql() {
  return `SELECT id, status, created_at, started_at
FROM play_sessions
WHERE status IN ('running', 'briefing', 'created')
ORDER BY created_at ASC`;
}

function listStaleSql() {
  return `SELECT id, status, created_at, started_at
FROM play_sessions
WHERE (
  status = 'running'
  AND started_at IS NOT NULL
  AND started_at < datetime('now', '-${RUNNING_MAX_WALL_MINUTES} minutes')
) OR (
  status IN ('briefing', 'created')
  AND created_at < datetime('now', '-${STALE_CREATED_MAX_MINUTES} minutes')
)
ORDER BY created_at ASC`;
}

async function finishSession(baseUrl, sessionId) {
  const timeoutUrl = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/timeout`;
  const timeoutResponse = await fetch(timeoutUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (timeoutResponse.ok) {
    return { sessionId, action: "timeout", status: timeoutResponse.status };
  }

  const deleteUrl = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`;
  const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });
  return {
    sessionId,
    action: "delete",
    status: deleteResponse.status,
    ok: deleteResponse.ok,
    detail: deleteResponse.ok ? undefined : await deleteResponse.text().catch(() => "")
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workerName = readWorkerName();
  const baseUrl = resolveWorkerUrl(options);
  const sessions = querySessions(options);

  console.log(`Worker: ${workerName}`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Mode: ${options.all ? "all active sessions" : "stale sessions only"} (${options.remote ? "remote" : "local"})`);
  console.log(`Found: ${sessions.length} session(s)`);

  if (sessions.length === 0) {
    console.log("掃除対象はありません。");
    return;
  }

  for (const session of sessions) {
    const started = session.startedAt ? ` started=${session.startedAt}` : "";
    console.log(`- ${session.id} [${session.status}] created=${session.createdAt}${started}`);
  }

  if (options.dryRun) {
    console.log("dry-run のため API は呼びませんでした。");
    return;
  }

  let okCount = 0;
  let failCount = 0;

  for (const session of sessions) {
    try {
      const result = await finishSession(baseUrl, session.id);
      const success = result.status >= 200 && result.status < 300;
      if (success) {
        okCount += 1;
        console.log(`✓ ${session.id} -> ${result.action} (${result.status})`);
      } else {
        failCount += 1;
        const detail = result.detail ? ` ${result.detail.slice(0, 120)}` : "";
        console.log(`✗ ${session.id} -> ${result.action} (${result.status})${detail}`);
      }
    } catch (error) {
      failCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✗ ${session.id} -> error: ${message}`);
    }
  }

  console.log(`Done: ${okCount} cleaned, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
