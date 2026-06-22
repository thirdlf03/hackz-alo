import type {Bindings} from './types.js';
import {getSessionDoStub} from './effect/sessionDoStub.js';

const RUNNING_MAX_WALL_MINUTES = 30;
const STALE_CREATED_MAX_MINUTES = 20;

export async function sweepStaleSessions(env: Bindings) {
  const running = await env.DB.prepare(
    `select id from play_sessions
     where status = 'running'
       and started_at is not null
       and started_at < datetime('now', ? || ' minutes')`
  )
    .bind(`-${String(RUNNING_MAX_WALL_MINUTES)}`)
    .all();

  const stale = await env.DB.prepare(
    `select id from play_sessions
     where status in ('briefing', 'created')
       and created_at < datetime('now', ? || ' minutes')`
  )
    .bind(`-${String(STALE_CREATED_MAX_MINUTES)}`)
    .all();

  const sessionIds = new Set<string>();
  for (const row of [...running.results, ...stale.results]) {
    const id = row.id;
    if (typeof id === 'string' && id) sessionIds.add(id);
  }

  let cleaned = 0;
  for (const sessionId of sessionIds) {
    try {
      await finishStaleSession(env, sessionId);
      cleaned += 1;
    } catch (error) {
      console.error(
        '[session-sweep]',
        sessionId,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (cleaned > 0) {
    console.log(`[session-sweep] cleaned ${String(cleaned)} stale session(s)`);
  }
  return cleaned;
}

async function finishStaleSession(env: Bindings, sessionId: string) {
  const stub = getSessionDoStub(env.SESSION_DO, sessionId);
  const timeoutUrl = new URL(
    `https://session.internal/internal/sessions/${encodeURIComponent(sessionId)}/timeout`
  );
  const response = await stub.fetch(
    new Request(timeoutUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{}',
    })
  );
  if (response.ok) return;

  const deleteUrl = new URL(
    `https://session.internal/internal/sessions/${encodeURIComponent(sessionId)}/delete`
  );
  await stub.fetch(new Request(deleteUrl, {method: 'DELETE'}));
}
