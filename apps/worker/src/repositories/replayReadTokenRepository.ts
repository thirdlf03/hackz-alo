import type {Bindings} from '../types.js';

export async function insertReplayReadToken(
  env: Bindings,
  input: {
    id: string;
    replayId: string;
    tokenHash: string;
    scope: string;
    expiresAt: string;
    createdAt: string;
  }
) {
  await env.DB.prepare(
    `insert into replay_read_tokens
     (id, replay_id, token_hash, scope, expires_at, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.id,
      input.replayId,
      input.tokenHash,
      input.scope,
      input.expiresAt,
      input.createdAt
    )
    .run();
}

export async function updateReplayVisibility(
  env: Bindings,
  replayId: string,
  visibility: string
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `update replays
     set visibility = ?, updated_at = ?
     where id = ?`
  )
    .bind(visibility, now, replayId)
    .run();
}
