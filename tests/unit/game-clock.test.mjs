import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  computeGameTimeMs,
  wallDelayForGameMs,
} from '../../packages/shared/src/gameClock.ts';

test('computeGameTimeMs advances with wall clock when running', () => {
  const base = computeGameTimeMs(1000, 10_000, 2, 10_500, true);
  assert.equal(base, 2000);
});

test('computeGameTimeMs stays frozen when not running', () => {
  const frozen = computeGameTimeMs(5000, 10_000, 3, 20_000, false);
  assert.equal(frozen, 5000);
});

test('computeGameTimeMs ignores wall clock when anchor is missing', () => {
  const anchored = computeGameTimeMs(900, undefined, 2, 50_000, true);
  assert.equal(anchored, 900);
});

test('wallDelayForGameMs scales by game speed', () => {
  assert.equal(wallDelayForGameMs(1000, 3000, 2), 1000);
  assert.equal(wallDelayForGameMs(1000, 1000, 4), 0);
});
