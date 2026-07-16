import type {Screen} from '../app/appTypes.js';

/**
 * Connection status for the session SSE subscription (see useSessionSse.ts).
 * 'connecting' is the very first connection attempt for a session (never
 * opened before); 'reconnecting' is any attempt after a previously-open
 * connection dropped; 'closed' reflects EventSource.readyState === CLOSED,
 * which the browser reaches (and stops auto-retrying) after an HTTP error
 * response.
 */
export type SseConnectionStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/** Screens on which the session SSE subscription should stay connected. */
export const SSE_ELIGIBLE_SCREENS: readonly Screen[] = [
  'lobby',
  'briefing',
  'play',
  'result',
  'hotwash',
];

export function isSseEligibleScreen(screen: Screen): boolean {
  return SSE_ELIGIBLE_SCREENS.includes(screen);
}

export const SSE_RECONNECT_BASE_MS = 1_000;
export const SSE_RECONNECT_MAX_MS = 30_000;

/**
 * Exponential backoff delay (ms) for recreating the EventSource after it
 * reaches readyState CLOSED. attempt is 0-based: 0 → 1s, 1 → 2s, 2 → 4s, ...
 * capped at SSE_RECONNECT_MAX_MS.
 */
export function sseReconnectDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt);
  const delay = SSE_RECONNECT_BASE_MS * 2 ** exponent;
  return Math.min(delay, SSE_RECONNECT_MAX_MS);
}

/**
 * Derives the UI-facing connection status from an EventSource readyState
 * observed on an 'error' event (or 'open', via the OPEN case).
 * hasOpenedBefore distinguishes the initial connection attempt from a
 * reconnect attempt after a previously successful connection dropped.
 */
export function sseStatusForReadyState(
  readyState: 0 | 1 | 2,
  hasOpenedBefore: boolean
): SseConnectionStatus {
  if (readyState === 1) return 'open';
  if (readyState === 2) return 'closed';
  return hasOpenedBefore ? 'reconnecting' : 'connecting';
}
