import {
  normalizeReplayResult,
  resolveEndingId,
} from '../../../../packages/shared/src/endings.js';
import {replayEventSummary} from '../../../../packages/shared/src/events.js';
import type {ReplayEvent} from '../../../../packages/shared/src/types.js';
import type {Bindings} from '../types.js';
import {getGameTimeMs, type StoredSession} from './sessionState.js';

export async function persistSession(
  env: Bindings,
  session: StoredSession,
  result?: string
) {
  const dbResult = normalizeReplayResult(result ?? '') || null;
  await env.DB.prepare(
    `update play_sessions
     set status = ?, started_at = ?, finished_at = ?, result = ?, duration_ms = ?
     where id = ?`
  )
    .bind(
      session.status,
      session.startedAt ?? null,
      session.finishedAt ?? null,
      dbResult,
      session.finishedAt ? getGameTimeMs(session) : null,
      session.sessionId
    )
    .run();
}

export async function persistReplayStart(
  env: Bindings,
  session: StoredSession
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `update replays set started_at = ?, recording_status = ?, updated_at = ? where id = ?`
  )
    .bind(session.startedAt ?? now, 'recording', now, session.replayId)
    .run();
}

export async function persistReplayResult(
  env: Bindings,
  session: StoredSession,
  result: string
) {
  const finishedAt = session.finishedAt ?? new Date().toISOString();
  await env.DB.prepare(
    `update replays
     set finished_at = coalesce(finished_at, ?), result = ?, ending_id = ?, duration_ms = ?, updated_at = ?
     where id = ?`
  )
    .bind(
      finishedAt,
      normalizeReplayResult(result),
      resolveEndingId(result),
      getGameTimeMs(session),
      new Date().toISOString(),
      session.replayId
    )
    .run();
}

export async function persistReplayEvent(env: Bindings, event: ReplayEvent) {
  await env.DB.prepare(
    `insert or replace into replay_events_index
     (replay_id, event_id, type, at_ms, summary, visibility)
     values (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      event.replayId,
      event.id,
      event.type,
      event.at,
      replayEventSummary(event),
      event.visibility
    )
    .run();
}
