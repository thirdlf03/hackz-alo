import type {StoredSession} from './sessionState.js';
import {lifecycleAlarmDeadline as lifecycleAlarmDeadlinePure} from '../pure/sessionLifecycleClock.js';

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
  return lifecycleAlarmDeadlinePure({...input, nowMs});
}
