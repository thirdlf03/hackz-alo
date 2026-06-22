import type {ReplayEvent} from '@incident/shared';
import {
  parseOptionalNumber,
  parsePartNumber,
  parseSequence,
} from '../http/params.js';
import type {WorkerApp} from '../http/context.js';
import {err, ok} from '../http/response.js';
import {
  bodySizeLimit,
  requireReplayWriteAccess,
} from '../http/writeAuthMiddleware.js';
import {enforceRateLimit, shouldEnforceRateLimit} from '../http/rateLimit.js';
import {
  createReplayComment,
  getReplay,
  getReplayChunkObjectKey,
  listFeaturedReplays,
  listReplayChunks,
  listReplayComments,
  listReplayEvents,
  markReplayFinished,
  putReplayThumbnail,
} from '../repositories/replayRepository.js';
import {
  completeMultipartUpload,
  createMultipartUpload,
  finalizeReplayVideo,
  getReplayObject,
  getStoredReplayVideo,
  headStoredReplayVideo,
  putReplayChunk,
  putReplayEvents,
  ReplayChunkConflictError,
  uploadMultipartPart,
} from '../storage/replayStorage.js';
import {normalizeOptionalMs} from '../http/params.js';

function replayIdParam(c: {
  req: {param: (name: string) => string | undefined};
}) {
  const replayId = c.req.param('replayId');
  if (!replayId) throw new Error('replayId is required');
  return replayId;
}

export function registerReplayRoutes(app: WorkerApp) {
  app.get('/api/replays/featured', async (c) =>
    c.json(ok(await listFeaturedReplays(c.env)))
  );

  app.post(
    '/api/replays/:replayId/chunks',
    bodySizeLimit(16 * 1024 * 1024),
    async (c) => {
      const replayId = replayIdParam(c);
      const denied = await requireReplayWriteAccess(c, replayId);
      if (denied) return denied;
      const replay = await getReplay(c.env, replayId);
      if (!replay) return c.json(err('not_found', 'replay not found'), 404);
      const seq = parseSequence(c.req.query('seq'));
      if (seq === undefined) {
        return c.json(err('bad_request', 'invalid seq'), 400);
      }
      const startedAtMs = parseOptionalNumber(c.req.query('startedAtMs'));
      const endedAtMs = parseOptionalNumber(c.req.query('endedAtMs'));
      if (startedAtMs === null || endedAtMs === null) {
        return c.json(err('bad_request', 'invalid chunk time range'), 400);
      }
      const stored = await putReplayChunk(c.env, {
        replayId: replay.id,
        seq,
        body: c.req.raw.body ?? new ArrayBuffer(0),
        ...(startedAtMs === undefined ? {} : {startedAtMs}),
        ...(endedAtMs === undefined ? {} : {endedAtMs}),
      }).catch((error: unknown) => {
        if (error instanceof ReplayChunkConflictError) {
          return c.json(err('conflict', 'chunk seq conflict'), 409);
        }
        throw error;
      });
      if (stored instanceof Response) return stored;
      return c.json(ok(stored));
    }
  );

  app.post('/api/replays/:replayId/finalize-video', async (c) => {
    const replayId = replayIdParam(c);
    const denied = await requireReplayWriteAccess(c, replayId);
    if (denied) return denied;
    const replay = await getReplay(c.env, replayId);
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const result = await finalizeReplayVideo(c.env, replay.id);
    if (result.status === 'missing') {
      return c.json(err('not_found', 'no chunks to finalize'), 404);
    }
    return c.json(ok(result));
  });

  app.post('/api/replays/:replayId/mpu/create', async (c) => {
    const replayId = replayIdParam(c);
    const denied = await requireReplayWriteAccess(c, replayId);
    if (denied) return denied;
    const replay = await getReplay(c.env, replayId);
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(await createMultipartUpload(c.env, replay.id)));
  });

  app.put(
    '/api/replays/:replayId/mpu/parts/:partNumber',
    bodySizeLimit(16 * 1024 * 1024),
    async (c) => {
      const replayId = replayIdParam(c);
      const denied = await requireReplayWriteAccess(c, replayId);
      if (denied) return denied;
      const replay = await getReplay(c.env, replayId);
      if (!replay) return c.json(err('not_found', 'replay not found'), 404);
      const partNumber = parsePartNumber(c.req.param('partNumber') ?? '');
      if (partNumber === undefined) {
        return c.json(err('bad_request', 'invalid part number'), 400);
      }
      return c.json(
        ok(
          await uploadMultipartPart(c.env, {
            replayId: replay.id,
            partNumber,
            body: c.req.raw.body ?? new ArrayBuffer(0),
          })
        )
      );
    }
  );

  app.post('/api/replays/:replayId/mpu/complete', async (c) => {
    const replayId = replayIdParam(c);
    const denied = await requireReplayWriteAccess(c, replayId);
    if (denied) return denied;
    const replay = await getReplay(c.env, replayId);
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(await completeMultipartUpload(c.env, replay.id)));
  });

  app.post(
    '/api/replays/:replayId/events',
    bodySizeLimit(256 * 1024),
    async (c) => {
      const replayId = replayIdParam(c);
      const denied = await requireReplayWriteAccess(c, replayId);
      if (denied) return denied;
      const replay = await getReplay(c.env, replayId);
      if (!replay) return c.json(err('not_found', 'replay not found'), 404);
      const events: unknown = await c.req.json().catch(() => []);
      if (!Array.isArray(events)) {
        return c.json(err('bad_request', 'events must be an array'), 400);
      }
      const seq = parseSequence(c.req.query('seq'));
      if (seq === undefined) {
        return c.json(err('bad_request', 'invalid seq'), 400);
      }
      return c.json(
        ok(
          await putReplayEvents(c.env, replay.id, seq, events as ReplayEvent[])
        )
      );
    }
  );

  app.post('/api/replays/:replayId/finish', async (c) => {
    const replayId = replayIdParam(c);
    const denied = await requireReplayWriteAccess(c, replayId);
    if (denied) return denied;
    const replay = await getReplay(c.env, replayId);
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      browserInfo?: Record<string, unknown>;
      videoDurationMs?: unknown;
      consentRecorded?: boolean;
    };
    const object = await getReplayObject(c.env, replay.id);
    const status = object ? 'ready' : 'upload_degraded';
    await markReplayFinished(c.env, {
      replayId: replay.id,
      status,
      browserInfo: body.browserInfo,
      videoDurationMs: normalizeOptionalMs(body.videoDurationMs),
      consentRecorded: body.consentRecorded === true,
    });
    return c.json(ok({replayId: replay.id, status}));
  });

  app.get('/api/replays/:replayId', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(replay));
  });

  app.on(['GET', 'HEAD'], '/api/replays/:replayId/video', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const meta = await headStoredReplayVideo(c.env, replay.id);
    if (!meta) return c.json(err('not_found', 'video not found'), 404);
    const contentType = meta.httpMetadata?.contentType ?? 'video/webm';
    if (c.req.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-length': String(meta.size),
          'cache-control': 'private, max-age=60',
        },
      });
    }
    const object = await getStoredReplayVideo(c.env, replay.id);
    if (!object) return c.json(err('not_found', 'video not found'), 404);
    return new Response(object.body, {
      headers: {
        'content-type': contentType,
        'cache-control': 'private, max-age=60',
      },
    });
  });

  app.get('/api/replays/:replayId/chunks', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(await listReplayChunks(c.env, replay.id)));
  });

  app.get('/api/replays/:replayId/chunks/:seq', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const seq = parseSequence(c.req.param('seq'));
    if (seq === undefined) {
      return c.json(err('bad_request', 'invalid seq'), 400);
    }
    const row = await getReplayChunkObjectKey(c.env, replay.id, seq);
    if (!row) return c.json(err('not_found', 'chunk not found'), 404);
    const object = await c.env.REPLAY_BUCKET.get(row.object_key);
    if (!object) return c.json(err('not_found', 'chunk not found'), 404);
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'video/webm',
      },
    });
  });

  app.get('/api/replays/:replayId/events', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(await listReplayEvents(c.env, replay.id)));
  });

  app.get('/api/replays/:replayId/thumbnail', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const key = replay.thumbnail_object_key;
    if (!key) return c.json(err('not_found', 'thumbnail not found'), 404);
    const object = await c.env.REPLAY_BUCKET.get(key);
    if (!object) return c.json(err('not_found', 'thumbnail not found'), 404);
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'image/webp',
      },
    });
  });

  app.get('/api/replays/:replayId/comments', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    return c.json(ok(await listReplayComments(c.env, replay.id)));
  });

  app.post('/api/replays/:replayId/comments', async (c) => {
    const replay = await getReplay(c.env, c.req.param('replayId'));
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);
    const clientIp = c.req.header('cf-connecting-ip') ?? 'unknown';
    if (shouldEnforceRateLimit(c.env)) {
      const limited = await enforceRateLimit(
        c.env,
        `comments:${clientIp}`,
        10,
        60
      );
      if (!limited.allowed) {
        return c.json(err('rate_limited', 'too many comments'), 429);
      }
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      atMs?: number;
      body?: string;
    };
    if (
      typeof body.atMs !== 'number' ||
      typeof body.body !== 'string' ||
      !body.body.trim()
    ) {
      return c.json(err('bad_request', 'atMs and body are required'), 400);
    }
    if (body.body.trim().length > 500) {
      return c.json(err('bad_request', 'comment too long'), 400);
    }
    return c.json(
      ok(
        await createReplayComment(c.env, {
          replayId: replay.id,
          atMs: body.atMs,
          body: body.body,
        })
      )
    );
  });

  app.post(
    '/api/replays/:replayId/thumbnail',
    bodySizeLimit(2 * 1024 * 1024),
    async (c) => {
      const replayId = replayIdParam(c);
      const denied = await requireReplayWriteAccess(c, replayId);
      if (denied) return denied;
      const replay = await getReplay(c.env, replayId);
      if (!replay) return c.json(err('not_found', 'replay not found'), 404);
      return c.json(
        ok(
          await putReplayThumbnail(
            c.env,
            replay.id,
            c.req.raw.body ?? new ArrayBuffer(0)
          )
        )
      );
    }
  );
}
