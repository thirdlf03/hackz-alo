import {createReplayEvent, type ReplayEvent} from '@incident/shared';
import type {Bindings} from '../types.js';
import {persistReplayEvent} from './sessionPersistence.js';
import type {StoredSession} from './sessionState.js';

export async function emitSessionReplayEvent(input: {
  env: Bindings;
  session: StoredSession;
  type: ReplayEvent['type'];
  at: number;
  actor: ReplayEvent['actor'];
  payload: Record<string, unknown>;
  storagePut: (session: StoredSession) => Promise<void>;
  broadcast: (event: ReplayEvent) => void;
  persistEvent?: (env: Bindings, event: ReplayEvent) => Promise<void>;
}) {
  const event = createReplayEvent({
    replayId: input.session.replayId,
    type: input.type,
    at: input.at,
    actor: input.actor,
    payload: input.payload,
  });
  const next = {
    ...input.session,
    eventSeq: input.session.eventSeq + 1,
    bufferedEvents: [...input.session.bufferedEvents, event].slice(-200),
  };
  await input.storagePut(next);
  const persistEvent = input.persistEvent ?? persistReplayEvent;
  await persistEvent(input.env, event);
  input.broadcast(event);
  return next;
}
