import type {SessionStatus} from '@incident/shared';
import type {Bindings} from '../types.js';
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

  if (input.storagePut) await input.storagePut(finished);
  try {
    await persistSessionImpl(input.env, finished, input.result);
    await persistReplayResultImpl(input.env, finished, input.result);
  } finally {
    await destroySandboxImpl(input.env, input.session.sessionId);
  }

  return finished;
}
