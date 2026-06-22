import type {StoredSession} from './sessionState.js';
import {getGameTimeMs} from './sessionState.js';

export function lifecycleAlarmDeadline(input: {
  session: StoredSession;
  timeLimitMs: number;
  idleTimeoutMs: number;
  gameEndBufferMs: number;
  lastActivityAt: number;
  hasSseClients: boolean;
  nowMs?: number | undefined;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (input.session.status !== 'running') return undefined;

  const remainingGameMs = Math.max(
    0,
    input.timeLimitMs - getGameTimeMs(input.session, nowMs)
  );
  const wallMsUntilGameEnd =
    remainingGameMs / Math.max(input.session.gameSpeed, 0.1) +
    input.gameEndBufferMs;
  const gameDeadline = nowMs + wallMsUntilGameEnd;
  const idleDeadline = input.hasSseClients
    ? Number.POSITIVE_INFINITY
    : input.lastActivityAt + input.idleTimeoutMs;

  return Math.ceil(Math.min(idleDeadline, gameDeadline));
}
