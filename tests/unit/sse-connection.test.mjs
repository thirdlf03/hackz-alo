import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  isSseEligibleScreen,
  sseReconnectDelayMs,
  sseStatusForReadyState,
  SSE_RECONNECT_BASE_MS,
  SSE_RECONNECT_MAX_MS,
} = await tsImport('../../apps/web/src/pure/sseConnection.ts', import.meta.url);

test('isSseEligibleScreen keeps the SSE subscription only on multiplayer-relevant screens', () => {
  assert.equal(isSseEligibleScreen('lobby'), true);
  assert.equal(isSseEligibleScreen('briefing'), true);
  assert.equal(isSseEligibleScreen('play'), true);
  assert.equal(isSseEligibleScreen('result'), true);
  assert.equal(isSseEligibleScreen('hotwash'), true);
  assert.equal(isSseEligibleScreen('select'), false);
  assert.equal(isSseEligibleScreen('scenario-list'), false);
  assert.equal(isSseEligibleScreen('replay'), false);
});

test('sseReconnectDelayMs doubles each attempt starting at the base delay', () => {
  assert.equal(sseReconnectDelayMs(0), SSE_RECONNECT_BASE_MS);
  assert.equal(sseReconnectDelayMs(1), SSE_RECONNECT_BASE_MS * 2);
  assert.equal(sseReconnectDelayMs(2), SSE_RECONNECT_BASE_MS * 4);
  assert.equal(sseReconnectDelayMs(3), SSE_RECONNECT_BASE_MS * 8);
});

test('sseReconnectDelayMs caps at the maximum backoff', () => {
  assert.equal(sseReconnectDelayMs(10), SSE_RECONNECT_MAX_MS);
  assert.equal(sseReconnectDelayMs(100), SSE_RECONNECT_MAX_MS);
});

test('sseReconnectDelayMs clamps negative attempts to the base delay', () => {
  assert.equal(sseReconnectDelayMs(-1), SSE_RECONNECT_BASE_MS);
});

test('sseStatusForReadyState maps OPEN and CLOSED readyStates directly', () => {
  assert.equal(sseStatusForReadyState(1, false), 'open');
  assert.equal(sseStatusForReadyState(1, true), 'open');
  assert.equal(sseStatusForReadyState(2, false), 'closed');
  assert.equal(sseStatusForReadyState(2, true), 'closed');
});

test('sseStatusForReadyState distinguishes first connect from reconnect while CONNECTING', () => {
  assert.equal(sseStatusForReadyState(0, false), 'connecting');
  assert.equal(sseStatusForReadyState(0, true), 'reconnecting');
});
