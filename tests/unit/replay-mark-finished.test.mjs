import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {markReplayFinished} = await tsImport(
  '../../apps/worker/src/repositories/replayRepository.ts',
  import.meta.url
);

function makeEnv(row) {
  const updates = [];
  return {
    row,
    updates,
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            return {sql, binds};
          },
        };
      },
    },
  };
}

function makeDb(env) {
  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async first() {
              if (sql.startsWith('select')) {
                return env.row;
              }
              return null;
            },
            async run() {
              env.updates.push({sql, binds});
              if (sql.startsWith('update')) {
                env.row = {
                  ...env.row,
                  recording_status: binds[1],
                  finished_at: env.row?.finished_at ?? binds[0],
                };
              }
              return {success: true};
            },
          };
        },
      };
    },
  };
}

test('markReplayFinished updates recording_status when finished_at is already set by the durable object but status is non-terminal', async () => {
  const env = makeEnv({
    finished_at: '2026-01-01T00:00:00.000Z',
    recording_status: 'recording',
  });
  env.DB = makeDb(env);

  await markReplayFinished(env, {
    replayId: 'repl_1',
    status: 'ready',
    videoDurationMs: 1000,
  });

  assert.equal(env.updates.length, 1);
  assert.equal(env.row.recording_status, 'ready');
  assert.equal(env.row.finished_at, '2026-01-01T00:00:00.000Z');
});

test('markReplayFinished is a no-op once recording_status has already reached a terminal state', async () => {
  const env = makeEnv({
    finished_at: '2026-01-01T00:00:00.000Z',
    recording_status: 'ready',
  });
  env.DB = makeDb(env);

  await markReplayFinished(env, {
    replayId: 'repl_1',
    status: 'upload_degraded',
    videoDurationMs: 2000,
  });

  assert.equal(env.updates.length, 0);
  assert.equal(env.row.recording_status, 'ready');
});
