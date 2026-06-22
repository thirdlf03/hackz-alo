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
  const idleDeadline = input.hasSseClients
    ? Number.POSITIVE_INFINITY
    : input.lastActivityAt + input.idleTimeoutMs;

  return Math.ceil(Math.min(idleDeadline, gameDeadline));
}
