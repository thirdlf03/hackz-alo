import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPaths = [
  path.join(rootDir, "migrations/0001_initial.sql"),
  path.join(rootDir, "migrations/0002_remove_auth.sql")
];
const sqliteAvailable = !spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).error;

test(
  "D1 migrations create tables and accept valid replay metadata",
  { skip: sqliteAvailable ? false : "sqlite3 is not available" },
  async () => {
    const result = runSql(`${await migrationSql()}
insert into scenarios (id, version, title, difficulty, manifest_object_key, created_at)
  values ('disk-full-001', 1, 'Disk Full', 'beginner', 'scenarios/disk-full-001/v1/manifest.json', '2026-06-20T00:00:00.000Z');
insert into play_sessions
  (id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at)
  values ('sess_1', 'disk-full-001', 1, 'session-sess_1', 'repl_1', 'created', '2026-06-20T00:00:00.000Z');
insert into replays
  (id, session_id, scenario_id, difficulty, started_at, recording_status, created_at, updated_at)
  values ('repl_1', 'sess_1', 'disk-full-001', 'beginner', '2026-06-20T00:00:00.000Z', 'idle', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
insert into replay_chunks
  (replay_id, seq, object_key, byte_size, started_at_ms, ended_at_ms, uploaded_at)
  values ('repl_1', 0, 'replays/repl_1/chunks/000000.webm', 1, 0, 5000, '2026-06-20T00:00:00.000Z');
insert into replay_events_index
  (replay_id, event_id, type, at_ms, summary, visibility)
  values ('repl_1', 'evt_1', 'session_start', 0, 'session_start', 'public_safe');
insert into replay_comments
  (id, replay_id, at_ms, body, created_at)
  values ('cmt_1', 'repl_1', 1200, 'nice save', '2026-06-20T00:00:00.000Z');
insert into replay_multipart_uploads
  (replay_id, object_key, upload_id, next_part_number, uploaded_parts_json, status, created_at, updated_at)
  values ('repl_1', 'replays/repl_1/video.webm', 'upload_1', 1, '[]', 'created', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
update replays set ending_id = 'clear-shift', result = 'resolved' where id = 'repl_1';
select
  (select count(*) from play_sessions),
  (select count(*) from replays),
  (select count(*) from replay_chunks),
  (select count(*) from replay_events_index),
  (select count(*) from replay_comments),
  (select count(*) from replay_multipart_uploads),
  (select ending_id from replays where id = 'repl_1');
`);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "1|1|1|1|1|1|clear-shift");
  }
);

test(
  "D1 migrations reject invalid enum values",
  { skip: sqliteAvailable ? false : "sqlite3 is not available" },
  async () => {
    const result = runSql(`${await migrationSql()}
insert into scenarios (id, version, title, difficulty, manifest_object_key, created_at)
  values ('disk-full-001', 1, 'Disk Full', 'beginner', 'scenarios/disk-full-001/v1/manifest.json', '2026-06-20T00:00:00.000Z');
insert into play_sessions
  (id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at)
  values ('sess_1', 'disk-full-001', 1, 'session-sess_1', 'repl_1', 'created', '2026-06-20T00:00:00.000Z');
insert into replays
  (id, session_id, scenario_id, difficulty, started_at, recording_status, created_at, updated_at)
  values ('repl_bad', 'sess_1', 'disk-full-001', 'beginner', '2026-06-20T00:00:00.000Z', 'bogus_status', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
`);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CHECK constraint failed/i);
  }
);

async function migrationSql() {
  const parts = await Promise.all(migrationPaths.map((file) => readFile(file, "utf8")));
  return parts.join("\n");
}

function runSql(sql) {
  return spawnSync("sqlite3", [":memory:"], { input: sql, encoding: "utf8" });
}
