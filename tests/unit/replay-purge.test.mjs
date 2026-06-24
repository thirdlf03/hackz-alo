import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {purgeReplayStorage} = await tsImport(
  '../../apps/worker/src/storage/replayPurge.ts',
  import.meta.url
);

test('purgeReplayStorage removes replay R2 objects and related DB rows', async () => {
  const replayId = 'repl_ops_001';
  const deletedKeys = [];
  const deletedTables = [];
  const env = {
    REPLAY_BUCKET: {
      async list(options) {
        assert.equal(options.prefix, `replays/${replayId}/`);
        return {
          truncated: false,
          objects: [
            {key: `replays/${replayId}/chunks/000000.webm`},
            {key: `replays/${replayId}/events/000000.jsonl`},
            {key: `replays/${replayId}/mpu/part-1`},
          ],
        };
      },
      async delete(key) {
        deletedKeys.push(key);
      },
    },
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            deletedTables.push({sql, binds});
            return {sql, binds};
          },
        };
      },
      async batch(statements) {
        assert.equal(statements.length, 5);
        return [];
      },
    },
  };

  await purgeReplayStorage(env, replayId);

  assert.deepEqual(
    new Set(deletedKeys),
    new Set([
      `replays/${replayId}/chunks/000000.webm`,
      `replays/${replayId}/events/000000.jsonl`,
      `replays/${replayId}/mpu/part-1`,
      `replays/${replayId}/video.webm`,
      `replays/${replayId}/thumbnail.webp`,
      `replays/${replayId}/events-manifest.json`,
    ])
  );
  assert.deepEqual(
    deletedTables.map(
      (statement) => statement.sql.match(/delete from ([a-z_]+)/)?.[1]
    ),
    [
      'replay_chunks',
      'replay_events_index',
      'replay_comments',
      'replay_multipart_uploads',
      'replays',
    ]
  );
  assert.equal(
    deletedTables.every((statement) => statement.binds[0] === replayId),
    true
  );
});

test('sweepExpiredReplays logs candidates purged and failed counts', async () => {
  const {sweepExpiredReplays} = await tsImport(
    '../../apps/worker/src/storage/replayPurge.ts',
    import.meta.url
  );
  const logs = [];
  const originalLog = console.log;
  console.log = (line) => {
    logs.push(JSON.parse(line));
  };
  let batchCount = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async all() {
            if (sql.includes('select id from replays')) {
              return {
                results: [{id: 'repl_ok'}, {id: 'repl_fail'}],
              };
            }
            return {results: []};
          },
        };
      },
      async batch() {
        batchCount += 1;
        if (batchCount === 2) throw new Error('d1 batch failed');
        return [];
      },
    },
    REPLAY_BUCKET: {
      async list() {
        return {truncated: false, objects: []};
      },
      async delete() {},
    },
  };

  try {
    assert.equal(await sweepExpiredReplays(env), 1);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    logs.find((log) => log.event === 'retention_sweep'),
    {
      event: 'retention_sweep',
      at: logs.find((log) => log.event === 'retention_sweep')?.at,
      candidates: 2,
      purged: 1,
      failed: 1,
      cutoff: logs.find((log) => log.event === 'retention_sweep')?.cutoff,
    }
  );
  assert.equal(
    logs.some(
      (log) =>
        log.event === 'retention_sweep_failed' &&
        log.replayId === 'repl_fail' &&
        /d1 batch failed/.test(log.message)
    ),
    true
  );
});
