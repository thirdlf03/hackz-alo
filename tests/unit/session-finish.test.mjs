import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {finishSessionTransaction} = await tsImport(
  '../../apps/worker/src/durable/sessionFinish.ts',
  import.meta.url
);

const baseSession = {
  sessionId: 'sess_finish',
  replayId: 'repl_finish',
  scenarioId: 'process-stop',
  status: 'running',
  gameTimeMs: 0,
  gameSpeed: 1,
  gameClockWallMs: 0,
  triggeredIds: [],
  firedAlertIds: [],
  firedSlackIds: [],
  eventSeq: 0,
  bufferedEvents: [],
};

test('finishSessionTransaction persists before sandbox destroy', async () => {
  const order = [];
  const finished = await finishSessionTransaction({
    env: {},
    session: baseSession,
    status: 'resolved',
    result: 'resolved',
    finishedAtIso: '2026-01-01T00:00:00.000Z',
    finishedAtMs: 1,
    storagePut: async () => {
      order.push('storage');
    },
    persistSession: async () => {
      order.push('persistSession');
    },
    persistReplayResult: async () => {
      order.push('persistReplayResult');
    },
    destroySandbox: async () => {
      order.push('destroy');
    },
  });

  assert.deepEqual(order, [
    'storage',
    'persistSession',
    'persistReplayResult',
    'destroy',
  ]);
  assert.equal(finished.status, 'resolved');
  assert.equal(finished.finishedAt, '2026-01-01T00:00:00.000Z');
});

test('finishSessionTransaction destroys sandbox even when persistence fails', async () => {
  const order = [];
  await assert.rejects(
    finishSessionTransaction({
      env: {},
      session: baseSession,
      status: 'failed',
      result: 'timeout',
      persistSession: async () => {
        order.push('persistSession');
        throw new Error('db unavailable');
      },
      persistReplayResult: async () => {
        order.push('persistReplayResult');
      },
      destroySandbox: async () => {
        order.push('destroy');
      },
    }),
    /db unavailable/
  );
  assert.deepEqual(order, ['persistSession', 'destroy']);
});
