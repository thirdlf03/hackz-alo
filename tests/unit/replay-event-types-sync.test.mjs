import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  REPLAY_EVENT_TYPES,
  REPLAY_EVENT_VISIBILITY_VALUES,
} from '../../packages/shared/src/replayEventTypes.ts';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const migrationPaths = [
  path.join(rootDir, 'migrations/0001_initial.sql'),
  path.join(rootDir, 'migrations/0002_remove_auth.sql'),
  path.join(rootDir, 'migrations/0003_replay_video_duration.sql'),
  path.join(rootDir, 'migrations/0004_replay_event_types.sql'),
  path.join(rootDir, 'migrations/0005_session_write_token.sql'),
  path.join(rootDir, 'migrations/0006_replay_consent.sql'),
  path.join(rootDir, 'migrations/0007_replay_visibility.sql'),
  path.join(rootDir, 'migrations/0008_session_read_tokens.sql'),
];
const sqliteAvailable = !spawnSync('sqlite3', ['-version'], {encoding: 'utf8'})
  .error;

test('REPLAY_EVENT_TYPES matches migration CHECK constraint', async () => {
  const migrationSql = await readFile(
    path.join(rootDir, 'migrations/0004_replay_event_types.sql'),
    'utf8'
  );
  const match = migrationSql.match(/type in \(([\s\S]*?)\)/);
  assert.ok(match, 'migration CHECK list not found');
  const migrationTypes = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...REPLAY_EVENT_TYPES].toSorted(),
    migrationTypes.toSorted(),
    'REPLAY_EVENT_TYPES must match migrations/0004_replay_event_types.sql'
  );
});

test('REPLAY_EVENT_VISIBILITY_VALUES matches migration CHECK constraint', async () => {
  const migrationSql = await readFile(
    path.join(rootDir, 'migrations/0004_replay_event_types.sql'),
    'utf8'
  );
  const match = migrationSql.match(/visibility in \(([\s\S]*?)\)/);
  assert.ok(match, 'migration visibility CHECK list not found');
  const migrationValues = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...REPLAY_EVENT_VISIBILITY_VALUES].toSorted(),
    migrationValues.toSorted(),
    'REPLAY_EVENT_VISIBILITY_VALUES must match migrations/0004_replay_event_types.sql'
  );
});

test(
  'each REPLAY_EVENT_TYPE inserts into replay_events_index',
  {skip: sqliteAvailable ? false : 'sqlite3 is not available'},
  async () => {
    const inserts = REPLAY_EVENT_TYPES.map(
      (type, index) => `insert into replay_events_index
  (replay_id, event_id, type, at_ms, summary, visibility)
  values ('repl_sync', 'evt_${String(index)}', '${type}', ${String(index)}, '${type}', 'public_safe');`
    ).join('\n');
    const result = runSql(`${await migrationSql()}${baseRows()}${inserts}
select count(*) from replay_events_index where replay_id = 'repl_sync';
`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      String(REPLAY_EVENT_TYPES.length),
      result.stderr
    );
  }
);

test(
  'file_saved event type is accepted after migrations',
  {skip: sqliteAvailable ? false : 'sqlite3 is not available'},
  async () => {
    const result = runSql(`${await migrationSql()}${baseRows()}
insert into replay_events_index
  (replay_id, event_id, type, at_ms, summary, visibility)
  values ('repl_1', 'evt_file', 'file_saved', 100, 'file saved', 'public_safe');
select type from replay_events_index where event_id = 'evt_file';
`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'file_saved');
  }
);

function baseRows() {
  return `
insert into scenarios (id, version, title, difficulty, manifest_object_key, created_at)
  values ('disk-full-001', 1, 'Disk Full', 'beginner', 'scenarios/disk-full-001/v1/manifest.json', '2026-06-20T00:00:00.000Z');
insert into play_sessions
  (id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at)
  values ('sess_1', 'disk-full-001', 1, 'session-sess_1', 'repl_1', 'created', '2026-06-20T00:00:00.000Z');
insert into replays
  (id, session_id, scenario_id, difficulty, started_at, recording_status, created_at, updated_at)
  values ('repl_1', 'sess_1', 'disk-full-001', 'beginner', '2026-06-20T00:00:00.000Z', 'idle', '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
`;
}

async function migrationSql() {
  const parts = await Promise.all(
    migrationPaths.map((file) => readFile(file, 'utf8'))
  );
  return parts.join('\n');
}

function runSql(sql) {
  return spawnSync('sqlite3', [':memory:'], {input: sql, encoding: 'utf8'});
}
