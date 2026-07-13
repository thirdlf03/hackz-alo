import type {SessionStatus} from '@incident/shared';
import type {Bindings} from '../types.js';
import {logStructured} from '../http/requestLog.js';
import {persistReplayResult, persistSession} from './sessionPersistence.js';
import {finishStoredSession, type StoredSession} from './sessionState.js';

async function defaultDestroySandbox(env: Bindings, sessionId: string) {
  const {destroySessionSandbox} = await import('../sandbox/sandboxDestroy.js');
  await destroySessionSandbox(env, sessionId);
}

export async function finishSessionTransaction(input: {
  env: Bindings;
  session: StoredSession;
  status: SessionStatus;
  result: string;
  finishedAtIso?: string;
  finishedAtMs?: number;
  storagePut?: (session: StoredSession) => Promise<void>;
  persistSession?: (
    env: Bindings,
    session: StoredSession,
    result: string
  ) => Promise<void>;
  persistReplayResult?: (
    env: Bindings,
    session: StoredSession,
    result: string
  ) => Promise<void>;
  destroySandbox?: (env: Bindings, sessionId: string) => Promise<void>;
}) {
  const finishedAtIso = input.finishedAtIso ?? new Date().toISOString();
  const finishedAtMs = input.finishedAtMs ?? Date.now();
  const finished = finishStoredSession(
    input.session,
    input.status,
    finishedAtIso,
    finishedAtMs
  );
  const persistSessionImpl = input.persistSession ?? persistSession;
  const persistReplayResultImpl =
    input.persistReplayResult ?? persistReplayResult;
  const destroySandboxImpl = input.destroySandbox ?? defaultDestroySandbox;
  const wallDuration = wallDurationMs(
    input.session.startedAt,
    finished.finishedAt
  );

  if (input.storagePut) await input.storagePut(finished);
  try {
    await persistSessionImpl(input.env, finished, input.result);
    await persistReplayResultImpl(input.env, finished, input.result);
  } finally {
    await destroySandboxImpl(input.env, input.session.sessionId);
    logStructured('session_cost_baseline', {
      sessionId: finished.sessionId,
      replayId: finished.replayId,
      scenarioId: finished.scenarioId,
      status: finished.status,
      gameDurationMs: finished.gameTimeMs,
      ...(wallDuration === undefined ? {} : {wallDurationMs: wallDuration}),
    });
  }

  return finished;
}

function wallDurationMs(startedAt?: string, finishedAt?: string) {
  if (!startedAt || !finishedAt) return undefined;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return undefined;
  return Math.max(0, finished - started);
}
