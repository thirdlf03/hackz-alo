#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {REPLAY_EVENT_TYPES, REPLAY_EVENT_VISIBILITY_VALUES} = await import(
  path.join(root, 'packages/shared/src/replayEventTypes.ts')
);
const {REPLAY_VISIBILITY_VALUES} = await import(
  path.join(root, 'packages/shared/src/replayVisibility.ts')
);

const replayEventMigrationPath = path.join(
  root,
  'migrations/0004_replay_event_types.sql'
);
const replayVisibilityMigrationPath = path.join(
  root,
  'migrations/0007_replay_visibility.sql'
);

await checkEnum({
  label: 'REPLAY_EVENT_TYPES',
  values: REPLAY_EVENT_TYPES,
  sql: await readFile(replayEventMigrationPath, 'utf8'),
  pattern: /type in \(([\s\S]*?)\)/,
});
await checkEnum({
  label: 'REPLAY_EVENT_VISIBILITY_VALUES',
  values: REPLAY_EVENT_VISIBILITY_VALUES,
  sql: await readFile(replayEventMigrationPath, 'utf8'),
  pattern: /visibility in \(([\s\S]*?)\)/,
});
await checkEnum({
  label: 'REPLAY_VISIBILITY_VALUES',
  values: REPLAY_VISIBILITY_VALUES,
  sql: await readFile(replayVisibilityMigrationPath, 'utf8'),
  pattern: /visibility in \(([\s\S]*?)\)/,
});

console.log(
  `audit-schema-sync: ok (${String(REPLAY_EVENT_TYPES.length)} replay event types, ${String(REPLAY_EVENT_VISIBILITY_VALUES.length)} replay event visibility values, ${String(REPLAY_VISIBILITY_VALUES.length)} replay visibility values)`
);

async function checkEnum({label, values, sql, pattern}) {
  const match = sql.match(pattern);
  if (!match) {
    console.error(`audit-schema-sync: could not parse ${label} CHECK list`);
    process.exit(1);
  }
  const migrationValues = [...match[1].matchAll(/'([^']+)'/g)].map(
    (m) => m[1]
  );
  const expected = [...values].toSorted();
  const actual = migrationValues.toSorted();
  const missingInMigration = expected.filter((t) => !actual.includes(t));
  const extraInMigration = actual.filter((t) => !expected.includes(t));
  if (missingInMigration.length === 0 && extraInMigration.length === 0) {
    return;
  }
  console.error(`audit-schema-sync: ${label} mismatch`);
  if (missingInMigration.length > 0) {
    console.error('  missing in migration:', missingInMigration.join(', '));
  }
  if (extraInMigration.length > 0) {
    console.error('  extra in migration:', extraInMigration.join(', '));
  }
  process.exit(1);
}
