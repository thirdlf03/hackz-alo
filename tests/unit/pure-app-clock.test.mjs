import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {computeLiveGameTimeMs, snapElapsedMsOnSpeedChange} = await tsImport(
  '../../apps/web/src/pure/appClock.ts',
  import.meta.url
);

test('computeLiveGameTimeMs caps interpolated play time at the session limit', () => {
  assert.equal(
    computeLiveGameTimeMs({
      screen: 'play',
      baseMs: 9_500,
      lastTickAt: 1_000,
      speed: 4,
      timeLimitMs: 10_000,
      finishing: false,
      now: 2_000,
    }),
    10_000
  );
  assert.equal(
    computeLiveGameTimeMs({
      screen: 'play',
      baseMs: 1_000,
      lastTickAt: 500,
      speed: 2,
      timeLimitMs: 10_000,
      finishing: true,
      now: 1_000,
    }),
    1_000
  );
});

test('snapElapsedMsOnSpeedChange never exceeds the scenario time limit', () => {
  assert.equal(
    snapElapsedMsOnSpeedChange({
      elapsedMs: 9_000,
      timeLimitMs: 10_000,
      lastTickAt: 500,
      oldSpeed: 4,
      now: 1_000,
    }),
    10_000
  );
});
