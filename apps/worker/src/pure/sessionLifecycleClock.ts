import type {StoredSession} from '../durable/sessionState.js';
import {computeGameTimeMs} from './sessionTime.js';

export function lifecycleAlarmDeadline(input: {
  session: StoredSession;
  timeLimitMs: number;
  idleTimeoutMs: number;
  gameEndBufferMs: number;
  lastActivityAt: number;
  hasSseClients: boolean;
  nowMs: number;
}) {
  if (input.session.status !== 'running') return undefined;

  const remainingGameMs = Math.max(
    0,
    input.timeLimitMs - computeGameTimeMs(input.session, input.nowMs)
  );
  const wallMsUntilGameEnd =
    remainingGameMs / Math.max(input.session.gameSpeed, 0.1) +
    input.gameEndBufferMs;
  const gameDeadline = input.nowMs + wallMsUntilGameEnd;
  // While SSE clients are connected we used to defer indefinitely to the
  // game deadline, but a hidden/backgrounded tab keeps its SSE connection
  // open while its participant heartbeat goes stale — that left no
  // periodic recheck for the "all participants offline" cleanup in
  // handleSessionAlarm (see sessionLifecycle.ts). Cap the wait to
  // idleTimeoutMs from now instead, so the alarm keeps re-firing at that
  // cadence for the life of the session and that check gets evaluated
  // regardless of SSE connection state.
  const idleDeadline = input.hasSseClients
    ? input.nowMs + input.idleTimeoutMs
    : input.lastActivityAt + input.idleTimeoutMs;

  return Math.ceil(Math.min(idleDeadline, gameDeadline));
}
