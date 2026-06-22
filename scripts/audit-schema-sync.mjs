#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {REPLAY_EVENT_TYPES} = await import(
  path.join(root, 'packages/shared/src/replayEventTypes.ts')
);

const migrationPath = path.join(
  root,
  'migrations/0004_replay_event_types.sql'
);
const migrationSql = await readFile(migrationPath, 'utf8');
const match = migrationSql.match(/type in \(([\s\S]*?)\)/);
if (!match) {
  console.error('audit-schema-sync: could not parse replay event CHECK list');
  process.exit(1);
}

const migrationTypes = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const expected = [...REPLAY_EVENT_TYPES].toSorted();
const actual = migrationTypes.toSorted();

const missingInMigration = expected.filter((t) => !actual.includes(t));
const extraInMigration = actual.filter((t) => !expected.includes(t));

if (missingInMigration.length > 0 || extraInMigration.length > 0) {
  console.error('audit-schema-sync: REPLAY_EVENT_TYPES mismatch');
  if (missingInMigration.length > 0) {
    console.error('  missing in migration:', missingInMigration.join(', '));
  }
  if (extraInMigration.length > 0) {
    console.error('  extra in migration:', extraInMigration.join(', '));
  }
  process.exit(1);
}

console.log(
  `audit-schema-sync: ok (${String(REPLAY_EVENT_TYPES.length)} replay event types)`
);
