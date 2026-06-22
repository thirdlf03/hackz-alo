import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {lifecycleAlarmDeadline} = await tsImport(
  '../../apps/worker/src/durable/sessionClock.ts',
  import.meta.url
);

test('lifecycleAlarmDeadline chooses idle or game-end deadline', () => {
  const session = {
    sessionId: 'sess_1',
    replayId: 'repl_1',
    scenarioId: 'scenario_1',
    status: 'running',
    gameTimeMs: 60_000,
    gameSpeed: 2,
    gameClockWallMs: 10_000,
    triggeredIds: [],
    firedAlertIds: [],
    firedSlackIds: [],
    eventSeq: 0,
    bufferedEvents: [],
  };

  assert.equal(
    lifecycleAlarmDeadline({
      session,
      timeLimitMs: 120_000,
      idleTimeoutMs: 30_000,
      gameEndBufferMs: 5_000,
      lastActivityAt: 12_000,
      hasSseClients: false,
      nowMs: 20_000,
    }),
    42_000
  );
  assert.equal(
    lifecycleAlarmDeadline({
      session,
      timeLimitMs: 120_000,
      idleTimeoutMs: 30_000,
      gameEndBufferMs: 5_000,
      lastActivityAt: 12_000,
      hasSseClients: true,
      nowMs: 20_000,
    }),
    45_000
  );
  assert.equal(
    lifecycleAlarmDeadline({
      session: {...session, status: 'failed'},
      timeLimitMs: 120_000,
      idleTimeoutMs: 30_000,
      gameEndBufferMs: 5_000,
      lastActivityAt: 12_000,
      hasSseClients: false,
      nowMs: 20_000,
    }),
    undefined
  );
});
