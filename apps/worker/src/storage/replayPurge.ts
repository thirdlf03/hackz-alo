import {
  replayEventsKey,
  replayEventsManifestKey,
  replayThumbnailKey,
  replayVideoKey,
} from '@incident/shared';
import type {Bindings} from '../types.js';
import {logStructured} from '../http/requestLog.js';

const retentionDays = 30;

export async function sweepExpiredReplays(env: Bindings) {
  try {
    return await sweepExpiredReplaysOnce(env);
  } catch (error) {
    logStructured('retention_sweep_failed', {
      stage: 'sweep',
      message: messageFrom(error),
    });
    throw error;
  }
}

async function sweepExpiredReplaysOnce(env: Bindings) {
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
  let failed = 0;
  for (const row of rows.results) {
    const replayId = row.id;
    if (!replayId) continue;
    try {
      await purgeReplayStorage(env, replayId);
      purged += 1;
    } catch (error) {
      failed += 1;
      logStructured('retention_sweep_failed', {
        replayId,
        message: messageFrom(error),
      });
    }
  }

  logStructured('retention_sweep', {
    candidates: rows.results.length,
    purged,
    failed,
    cutoff,
  });
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
    'select object_key, byte_size from replay_chunks where replay_id = ?'
  )
    .bind(replayId)
    .all<{object_key: string; byte_size: number}>();
  if (rows.results.length === 0) {
    return {purged: 0, rawChunkBytes: 0};
  }

  const startedAt = Date.now();
  await Promise.all(
    rows.results.map((row) => env.REPLAY_BUCKET.delete(row.object_key))
  );
  await env.DB.prepare('delete from replay_chunks where replay_id = ?')
    .bind(replayId)
    .run();

  const rawChunkBytes = rows.results.reduce(
    (sum, row) => sum + (Number.isFinite(row.byte_size) ? row.byte_size : 0),
    0
  );
  logStructured('replay_chunks_purged', {
    replayId,
    chunkCount: rows.results.length,
    rawChunkBytes,
    durationMs: Date.now() - startedAt,
  });
  return {purged: rows.results.length, rawChunkBytes};
}

export async function purgeReplayChunksAfterFinalVideo(
  env: Bindings,
  replayId: string
) {
  const finalVideo = await env.REPLAY_BUCKET.head(replayVideoKey(replayId));
  if (!finalVideo || finalVideo.size <= 0) {
    logStructured('replay_chunk_cleanup_skipped', {
      replayId,
      reason: 'final_video_missing',
    });
    return {purged: 0, rawChunkBytes: 0, skipped: true as const};
  }
  return {
    ...(await purgeReplayChunksOnly(env, replayId)),
    skipped: false as const,
  };
}

export async function sweepFinalizedReplayChunks(env: Bindings) {
  const rows = await env.DB.prepare(
    `select id from replays
     where recording_status = 'ready'
       and video_object_key is not null
       and exists (
         select 1 from replay_chunks
         where replay_chunks.replay_id = replays.id
       )
     limit 100`
  ).all<{id: string}>();

  let purged = 0;
  let failed = 0;
  for (const row of rows.results) {
    if (!row.id) continue;
    try {
      const result = await purgeReplayChunksAfterFinalVideo(env, row.id);
      purged += result.purged;
    } catch (error) {
      failed += 1;
      logStructured('replay_chunk_cleanup_failed', {
        replayId: row.id,
        message: messageFrom(error),
      });
    }
  }
  logStructured('replay_chunk_cleanup_sweep', {
    candidates: rows.results.length,
    purged,
    failed,
  });
  return {candidates: rows.results.length, purged, failed};
}

export function replayEventsPrefix(replayId: string) {
  return replayEventsKey(replayId, 0).replace(/000000\.jsonl$/, '');
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
