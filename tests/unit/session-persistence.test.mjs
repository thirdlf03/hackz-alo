import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  persistReplayEvent,
  persistReplayResult,
  persistReplayStart,
  persistSession,
} = await tsImport(
  '../../apps/worker/src/durable/sessionPersistence.ts',
  import.meta.url
);

test('persistSession stores normalized terminal session fields', async () => {
  const {env, statements} = createEnvRecorder();
  const session = testSession({
    status: 'failed',
    startedAt: '2026-06-22T00:00:00.000Z',
    finishedAt: '2026-06-22T00:05:00.000Z',
    gameTimeMs: 4567,
  });

  await persistSession(env, session, 'false_resolve');

  assert.match(statements[0].sql, /update play_sessions/);
  assert.deepEqual(statements[0].binds, [
    'failed',
    '2026-06-22T00:00:00.000Z',
    '2026-06-22T00:05:00.000Z',
    'failed',
    4567,
    'sess_1',
  ]);
});

test('persistReplayStart marks the replay as recording', async () => {
  const {env, statements} = createEnvRecorder();
  const session = testSession({
    status: 'running',
    startedAt: '2026-06-22T00:00:00.000Z',
  });

  await persistReplayStart(env, session);

  assert.match(statements[0].sql, /update replays set started_at/);
  assert.equal(statements[0].binds[0], '2026-06-22T00:00:00.000Z');
  assert.equal(statements[0].binds[1], 'recording');
  assert.match(statements[0].binds[2], isoDatePattern);
  assert.equal(statements[0].binds[3], 'repl_1');
});

test('persistReplayResult stores normalized result and ending id', async () => {
  const {env, statements} = createEnvRecorder();
  const session = testSession({
    status: 'failed',
    finishedAt: '2026-06-22T00:05:00.000Z',
    gameTimeMs: 4567,
  });

  await persistReplayResult(env, session, 'timeout');

  assert.match(statements[0].sql, /set finished_at = coalesce/);
  assert.deepEqual(statements[0].binds.slice(0, 4), [
    '2026-06-22T00:05:00.000Z',
    'failed',
    'overtime',
    4567,
  ]);
  assert.match(statements[0].binds[4], isoDatePattern);
  assert.equal(statements[0].binds[5], 'repl_1');
});

test('persistReplayEvent indexes replay event summary and visibility', async () => {
  const {env, statements} = createEnvRecorder();

  await persistReplayEvent(env, {
    id: 'evt_1',
    replayId: 'repl_1',
    type: 'terminal_input',
    at: 1234,
    actor: 'player',
    payload: {data: 'curl /health\n'},
    visibility: 'private',
  });

  assert.match(statements[0].sql, /insert or replace into replay_events_index/);
  assert.deepEqual(statements[0].binds, [
    'repl_1',
    'evt_1',
    'terminal_input',
    1234,
    'command: curl /health',
    'private',
  ]);
});

const isoDatePattern = /^\d{4}-\d{2}-\d{2}T/;

function createEnvRecorder() {
  const statements = [];
  return {
    env: {
      DB: {
        prepare(sql) {
          return {
            sql,
            binds: [],
            bind(...values) {
              this.binds = values;
              return this;
            },
            async run() {
              statements.push({sql: this.sql, binds: this.binds});
              return {};
            },
          };
        },
      },
    },
    statements,
  };
}

function testSession(overrides = {}) {
  return {
    sessionId: 'sess_1',
    replayId: 'repl_1',
    scenarioId: 'scenario_1',
    status: 'briefing',
    gameTimeMs: 0,
    gameSpeed: 1,
    triggeredIds: [],
    firedAlertIds: [],
    firedChatIds: [],
    eventSeq: 0,
    bufferedEvents: [],
    ...overrides,
  };
}
