import {
  replayChunkKey,
  replayEventsKey,
  replayEventsManifestKey,
  replayThumbnailKey,
  replayVideoKey,
} from '@incident/shared';
import type {Bindings} from '../types.js';
import {logStructured} from '../http/requestLog.js';

const retentionDays = 90;

export async function sweepExpiredReplays(env: Bindings) {
  const cutoff = new Date(
    Date.now() - retentionDays * 86_400_000
  ).toISOString();
  const rows = await env.DB.prepare(
    `select id from replays
     where finished_at is not null
       and finished_at < ?
     limit 100`
  )
    .bind(cutoff)
    .all<{id: string}>();

  let purged = 0;
  for (const row of rows.results) {
    const replayId = row.id;
    if (!replayId) continue;
    await purgeReplayStorage(env, replayId);
    purged += 1;
  }

  if (purged > 0) {
    logStructured('retention_sweep', {purged, cutoff});
  }
  return purged;
}

export async function purgeReplayStorage(env: Bindings, replayId: string) {
  const prefix = `replays/${replayId}/`;
  let cursor: string | undefined;
  do {
    const page = cursor
      ? await env.REPLAY_BUCKET.list({prefix, cursor})
      : await env.REPLAY_BUCKET.list({prefix});
    await Promise.all(
      page.objects.map((object) => env.REPLAY_BUCKET.delete(object.key))
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (const key of [
    replayVideoKey(replayId),
    replayThumbnailKey(replayId),
    replayEventsManifestKey(replayId),
  ]) {
    await env.REPLAY_BUCKET.delete(key).catch(() => undefined);
  }

  await env.DB.batch([
    env.DB.prepare('delete from replay_chunks where replay_id = ?').bind(
      replayId
    ),
    env.DB.prepare('delete from replay_events_index where replay_id = ?').bind(
      replayId
    ),
    env.DB.prepare('delete from replay_comments where replay_id = ?').bind(
      replayId
    ),
    env.DB.prepare(
      'delete from replay_multipart_uploads where replay_id = ?'
    ).bind(replayId),
    env.DB.prepare('delete from replays where id = ?').bind(replayId),
  ]);
}

export async function purgeReplayChunksOnly(env: Bindings, replayId: string) {
  const rows = await env.DB.prepare(
    'select seq from replay_chunks where replay_id = ?'
  )
    .bind(replayId)
    .all<{seq: number}>();
  for (const row of rows.results) {
    if (typeof row.seq !== 'number') continue;
    await env.REPLAY_BUCKET.delete(replayChunkKey(replayId, row.seq)).catch(
      () => undefined
    );
  }
}

export function replayEventsPrefix(replayId: string) {
  return replayEventsKey(replayId, 0).replace(/000000\.jsonl$/, '');
}
