import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  containsPoint,
  computeLiveGameTimeMs,
  readReplayIdFromSearch,
  snapElapsedMsOnSpeedChange,
  toErrorMessage,
  toLogicalCanvasPoint,
} = await tsImport('../../apps/web/src/app/appUtils.ts', import.meta.url);

test('readReplayIdFromSearch reads replay id from window search params', () => {
  const original = globalThis.window;
  globalThis.window = {
    location: {search: '?replay=  replay-abc  '},
  };
  assert.equal(readReplayIdFromSearch(), 'replay-abc');
  globalThis.window = original;
  assert.equal(readReplayIdFromSearch(), undefined);
});

test('toLogicalCanvasPoint maps DOM coordinates to logical canvas space', () => {
  const canvas = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      width: 960,
      height: 540,
    }),
  };
  const point = toLogicalCanvasPoint({clientX: 580, clientY: 320}, canvas);
  assert.equal(point.x, 960);
  assert.equal(point.y, 540);
});

test('containsPoint respects inclusive rectangle bounds', () => {
  const rect = {x: 10, y: 20, width: 100, height: 40};
  assert.equal(containsPoint(rect, 10, 20), true);
  assert.equal(containsPoint(rect, 110, 60), true);
  assert.equal(containsPoint(rect, 9, 20), false);
  assert.equal(containsPoint(rect, 10, 61), false);
});

test('computeLiveGameTimeMs caps interpolated play time at the session limit', () => {
  const now = performance.now();
  assert.equal(
    computeLiveGameTimeMs({
      screen: 'play',
      baseMs: 9_500,
      lastTickAt: now - 1_000,
      speed: 4,
      timeLimitMs: 10_000,
      finishing: false,
    }),
    10_000
  );
  assert.equal(
    computeLiveGameTimeMs({
      screen: 'play',
      baseMs: 1_000,
      lastTickAt: now - 500,
      speed: 2,
      timeLimitMs: 10_000,
      finishing: true,
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

test('toErrorMessage preserves Error messages and stringifies other values', () => {
  assert.equal(toErrorMessage(new Error('disk full')), 'disk full');
  assert.equal(toErrorMessage(404), '404');
});
