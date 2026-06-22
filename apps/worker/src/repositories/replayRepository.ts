import {replayThumbnailKey} from '@incident/shared';
import type {Bindings} from '../types.js';

export interface ReplayRow {
  id: string;
  thumbnail_object_key: string | null;
}

export async function getReplay(env: Bindings, replayId: string) {
  return env.DB.prepare('select * from replays where id = ?')
    .bind(replayId)
    .first<ReplayRow>();
}

export async function listFeaturedReplays(env: Bindings) {
  const rows = await env.DB.prepare(
    `select id, scenario_id, difficulty, result, duration_ms, video_duration_ms, thumbnail_object_key, created_at
     from replays where featured = 1 order by created_at desc limit 20`
  ).all();
  return rows.results;
}

export async function markReplayFinished(
  env: Bindings,
  input: {
    replayId: string;
    status: string;
    browserInfo?: Record<string, unknown> | undefined;
    videoDurationMs: number | null;
    consentRecorded?: boolean | undefined;
  }
) {
  const existing = await env.DB.prepare(
    'select finished_at from replays where id = ?'
  )
    .bind(input.replayId)
    .first<{finished_at: string | null}>();
  const now = new Date().toISOString();
  if (existing?.finished_at) {
    return;
  }
  await env.DB.prepare(
    `update replays
     set finished_at = coalesce(finished_at, ?),
         recording_status = ?,
         browser_info_json = coalesce(?, browser_info_json),
         video_duration_ms = coalesce(?, video_duration_ms),
         consent_recorded_at = case when ? = 1 then coalesce(consent_recorded_at, ?) else consent_recorded_at end,
         updated_at = ?
     where id = ?`
  )
    .bind(
      now,
      input.status,
      input.browserInfo ? JSON.stringify(input.browserInfo) : null,
      input.videoDurationMs,
      input.consentRecorded ? 1 : 0,
      now,
      now,
      input.replayId
    )
    .run();
}

export async function listReplayChunks(env: Bindings, replayId: string) {
  const rows = await env.DB.prepare(
    'select seq, object_key, byte_size, started_at_ms, ended_at_ms from replay_chunks where replay_id = ? order by seq asc'
  )
    .bind(replayId)
    .all();
  return rows.results;
}

export async function getReplayChunkObjectKey(
  env: Bindings,
  replayId: string,
  seq: number
) {
  return env.DB.prepare(
    'select object_key from replay_chunks where replay_id = ? and seq = ?'
  )
    .bind(replayId, seq)
    .first<{object_key: string}>();
}

export async function listReplayEvents(
  env: Bindings,
  replayId: string,
  options?: {includePrivate?: boolean}
) {
  const includePrivate = options?.includePrivate === true;
  const rows = await env.DB.prepare(
    includePrivate
      ? 'select event_id, type, at_ms, summary, visibility from replay_events_index where replay_id = ? order by at_ms asc'
      : `select event_id, type, at_ms, summary, visibility from replay_events_index
         where replay_id = ? and visibility = 'public_safe'
         order by at_ms asc`
  )
    .bind(replayId)
    .all();
  return rows.results;
}

export async function listReplayComments(env: Bindings, replayId: string) {
  const rows = await env.DB.prepare(
    'select id, at_ms, body, created_at from replay_comments where replay_id = ? order by at_ms asc'
  )
    .bind(replayId)
    .all();
  return rows.results;
}

export async function createReplayComment(
  env: Bindings,
  input: {replayId: string; atMs: number; body: string}
) {
  const id = `cmt_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  const body = input.body.trim().slice(0, 500);
  if (body.length === 0) throw new Error('comment body required');
  await env.DB.prepare(
    'insert into replay_comments (id, replay_id, at_ms, body, created_at) values (?, ?, ?, ?, ?)'
  )
    .bind(id, input.replayId, Math.max(0, Math.floor(input.atMs)), body, now)
    .run();
  return {id, atMs: input.atMs, body, createdAt: now};
}

export async function putReplayThumbnail(
  env: Bindings,
  replayId: string,
  body: ReadableStream | ArrayBuffer | Blob
) {
  const key = replayThumbnailKey(replayId);
  await env.REPLAY_BUCKET.put(key, body, {
    httpMetadata: {contentType: 'image/webp'},
  });
  await env.DB.prepare(
    'update replays set thumbnail_object_key = ?, updated_at = ? where id = ?'
  )
    .bind(key, new Date().toISOString(), replayId)
    .run();
  return {key};
}
