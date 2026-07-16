import {
  type ExerciseSnapshot,
  type ReplayEvent,
  type SessionStatus,
} from '@incident/shared';
import {readInternalJsonObject} from '../http/body.js';
import {jsonOk} from '../http/response.js';
import {
  getGameTimeMs,
  isTerminalStatus,
  type StoredSession,
} from './sessionState.js';

const SESSION_TIMEOUT_BODY_MAX_BYTES = 8 * 1024;

export interface SessionTimeoutDeps {
  destroySandbox: (sessionId: string) => Promise<void>;
  markOfflineIfOthersOnline: (
    session: StoredSession,
    participantId: string
  ) => Promise<ExerciseSnapshot | null>;
  broadcastPresence: (snapshot: ExerciseSnapshot) => void;
  broadcastExerciseState: (snapshot: ExerciseSnapshot) => void;
  finishSession: (
    session: StoredSession,
    status: SessionStatus,
    result: string
  ) => Promise<StoredSession>;
  emit: (
    session: StoredSession,
    type: ReplayEvent['type'],
    at: number,
    actor: ReplayEvent['actor'],
    payload: Record<string, unknown>
  ) => Promise<StoredSession>;
  snapshotFor: (session: StoredSession) => unknown;
}

/**
 * `/timeout` doubles as both the real end-of-session call (explicit
 * "give up"/time-limit finish, or the sweep/alarm cleanup path — none of
 * which pass a participantId) and, historically, the client's
 * best-effort pagehide/hidden-tab departure beacon. The latter now goes
 * through the participantId-aware branch below: with a participantId in
 * the body, a lone departing participant no longer ends the session for
 * everyone else — they're just marked offline — unless nobody else is
 * online, in which case it falls through to the original full-session
 * finish. Callers without a participantId (or before any exercise room
 * exists) keep the original unconditional-finish behavior.
 */
export async function timeoutSessionAction(
  session: StoredSession,
  request: Request | undefined,
  deps: SessionTimeoutDeps
) {
  if (isTerminalStatus(session.status)) {
    await deps.destroySandbox(session.sessionId);
    return jsonOk({session: deps.snapshotFor(session)});
  }

  const participantId = await timeoutNotifierParticipantId(request);
  if (participantId) {
    const snapshot = await deps.markOfflineIfOthersOnline(
      session,
      participantId
    );
    if (snapshot) {
      deps.broadcastPresence(snapshot);
      deps.broadcastExerciseState(snapshot);
      return jsonOk({session: deps.snapshotFor(session)});
    }
  }

  const finished = await deps.finishSession(session, 'failed', 'timeout');
  const result = await deps.emit(
    finished,
    'session_end',
    getGameTimeMs(finished),
    'system',
    {result: 'timeout'}
  );
  return jsonOk({session: deps.snapshotFor(result)});
}

async function timeoutNotifierParticipantId(request: Request | undefined) {
  if (!request) return undefined;
  const body = (await readInternalJsonObject(
    request,
    SESSION_TIMEOUT_BODY_MAX_BYTES
  )) as {participantId?: unknown};
  return typeof body.participantId === 'string'
    ? body.participantId
    : undefined;
}
