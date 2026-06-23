import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Effect} from 'effect';
import {tsImport} from 'tsx/esm/api';

const {pollSessionMetricsOnce} = await tsImport(
  '../../apps/web/src/effect/metricsPoll.ts',
  import.meta.url
);

test('pollSessionMetricsOnce maps API success to metrics outcomes', async () => {
  const metrics = {
    at: 1,
    cpu: 10,
    memory: 20,
    disk: 30,
    http5xxRate: 0,
    latencyP95Ms: 100,
    rps: 5,
    dbConnections: 2,
    queueDepth: 1,
  };
  const outcome = await Effect.runPromise(
    pollSessionMetricsOnce(
      {
        getSessionMetrics: async () => metrics,
        getSessionClock: async () => ({
          gameTimeMs: 0,
          gameSpeed: 1,
          timeLimitMs: 300_000,
          alerts: [],
          slackMessages: [],
        }),
      },
      'sess_1'
    )
  );

  assert.equal(outcome.kind, 'metrics');
  assert.deepEqual(outcome.metrics, metrics);
  assert.equal(typeof outcome.edgeRttMs, 'number');
  assert.ok(outcome.edgeRttMs >= 0);
});

test('pollSessionMetricsOnce maps API failures to offline outcomes', async () => {
  const outcome = await Effect.runPromise(
    pollSessionMetricsOnce(
      {
        getSessionMetrics: async () => {
          throw new Error('network down');
        },
      },
      'sess_1'
    )
  );

  assert.deepEqual(outcome, {kind: 'offline'});
});
