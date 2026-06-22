import {proxyToSandbox} from '@cloudflare/sandbox';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {
  listScenarios,
  getScenario,
  getRandomScenarioByDifficulty,
} from '@incident/scenarios';
import {
  replayThumbnailKey,
  type ApiResult,
  type Difficulty,
  type ReplayEvent,
} from '@incident/shared';
import {SessionDurableObject} from './durable/SessionDurableObject.js';
import {sweepStaleSessions} from './sessionSweep.js';
import {
  completeMultipartUpload,
  createMultipartUpload,
  getReplayObject,
  putReplayChunk,
  putReplayEvents,
  uploadMultipartPart,
} from './storage/replayStorage.js';
import type {Bindings} from './types.js';

export {SessionDurableObject};
export {Sandbox} from '@cloudflare/sandbox';

const app = new Hono<{Bindings: Bindings}>();
type WorkerContext = Context<{Bindings: Bindings}>;

const difficulties = new Set<Difficulty>([
  'beginner',
  'intermediate',
  'advanced',
]);
const sessionActionsWithoutDbLookup = new Set([
  'events',
  'clock',
  'metrics',
  'logs',
  'storage',
]);

app.post('/api/dev/terminal-debug', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    event?: string;
    detail?: Record<string, unknown>;
    at?: number;
  };
  console.log(
    '[terminal-debug]',
    body.event ?? 'unknown',
    JSON.stringify(body.detail ?? {})
  );
  return c.json(ok({logged: true}));
});

app.get('/api/scenarios', (c) => c.json(ok(listScenarios())));

app.get('/api/scenarios/:scenarioId', (c) => {
  const scenario = getScenario(c.req.param('scenarioId'));
  if (!scenario) return c.json(err('not_found', 'scenario not found'), 404);
  return c.json(ok(scenario));
});

app.post('/api/sessions', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scenarioId?: string;
    difficulty?: string;
  };
  const scenario = resolveRequestedScenario(body);
  if (!scenario) {
    return c.json(
      err('bad_request', 'scenarioId or difficulty is required'),
      400
    );
  }

  const sessionId = `sess_${crypto.randomUUID().replaceAll('-', '')}`;
  const replayId = `repl_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert into play_sessions
     (id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      scenario.id,
      scenario.version,
      `session-${sessionId}`,
      replayId,
      'created',
      now
    )
    .run();
  await c.env.DB.prepare(
    `insert into replays
     (id, session_id, scenario_id, difficulty, started_at, recording_status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      replayId,
      sessionId,
      scenario.id,
      scenario.difficulty,
      now,
      'idle',
      now,
      now
    )
    .run();

  const bootstrapResponse = await fetchSessionObject(
    c.env,
    sessionId,
    'bootstrap',
    {
      sessionId,
      replayId,
      scenarioId: scenario.id,
    }
  );
  if (!bootstrapResponse.ok) return bootstrapResponse;

  return c.json(ok({sessionId, replayId, scenario}));
});

function resolveRequestedScenario(body: {
  scenarioId?: string;
  difficulty?: string;
}) {
  if (body.scenarioId) return getScenario(body.scenarioId);
  if (!body.difficulty || !difficulties.has(body.difficulty as Difficulty)) {
    return undefined;
  }
  return getRandomScenarioByDifficulty(
    body.difficulty as Difficulty,
    randomFloat
  );
}

function randomFloat() {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return (values[0] ?? 0) / 0x100000000;
}

app.get('/api/sessions/:sessionId', async (c) => proxySession(c, 'snapshot'));
app.post('/api/sessions/:sessionId/start', async (c) => {
  const sessionId = c.req.param('sessionId');
  const record = await getSession(c.env, sessionId);
  if (!record) return c.json(err('not_found', 'session not found'), 404);
  return proxySession(c, 'start', {
    sessionId,
    replayId: record.replay_id,
    scenarioId: record.scenario_id,
  });
});
app.post('/api/sessions/:sessionId/resolve', async (c) =>
  proxySession(c, 'resolve')
);
app.post('/api/sessions/:sessionId/retire', async (c) =>
  proxySession(c, 'retire')
);
app.post('/api/sessions/:sessionId/timeout', async (c) =>
  proxySession(c, 'timeout')
);
app.delete('/api/sessions/:sessionId', async (c) =>
  proxySessionDelete(c, 'delete')
);
app.get('/api/sessions/:sessionId/events', async (c) =>
  proxySession(c, 'events')
);
app.get('/api/sessions/:sessionId/clock', async (c) =>
  proxySession(c, 'clock')
);
app.post('/api/sessions/:sessionId/clock', async (c) =>
  proxySession(c, 'clock', await c.req.json().catch(() => ({})))
);
app.get('/api/sessions/:sessionId/metrics', async (c) =>
  proxySession(c, 'metrics')
);
app.get('/api/sessions/:sessionId/logs', async (c) => proxySession(c, 'logs'));
app.get('/api/sessions/:sessionId/storage', async (c) =>
  proxySession(c, 'storage')
);
app.get('/api/sessions/:sessionId/files', async (c) =>
  proxySession(c, 'files')
);
app.get('/api/sessions/:sessionId/file', async (c) => proxySession(c, 'file'));
app.put('/api/sessions/:sessionId/file', async (c) =>
  proxySession(c, 'file', await c.req.json().catch(() => ({})))
);
app.get('/api/sessions/:sessionId/ws/terminal', async (c) =>
  proxySession(c, 'terminal')
);
app.post('/api/sessions/:sessionId/terminal/interrupt', async (c) =>
  proxySession(c, 'terminal-interrupt')
);
app.post('/api/sessions/:sessionId/terminal/resize', async (c) =>
  proxySession(c, 'terminal-resize', await c.req.json().catch(() => ({})))
);

app.get('/api/replays/featured', async (c) => {
  const rows = await c.env.DB.prepare(
    `select id, scenario_id, difficulty, result, duration_ms, video_duration_ms, thumbnail_object_key, created_at
     from replays where featured = 1 order by created_at desc limit 20`
  ).all();
  return c.json(ok(rows.results));
});

app.post('/api/replays/:replayId/chunks', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const seq = parseSequence(c.req.query('seq'));
  if (seq === undefined) return c.json(err('bad_request', 'invalid seq'), 400);
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
  });
  return c.json(ok(stored));
});

app.post('/api/replays/:replayId/mpu/create', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  return c.json(ok(await createMultipartUpload(c.env, replay.id)));
});

app.put('/api/replays/:replayId/mpu/parts/:partNumber', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const partNumber = parsePartNumber(c.req.param('partNumber'));
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
});

app.post('/api/replays/:replayId/mpu/complete', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  return c.json(ok(await completeMultipartUpload(c.env, replay.id)));
});

app.post('/api/replays/:replayId/events', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const events: unknown = await c.req.json().catch(() => []);
  if (!Array.isArray(events)) {
    return c.json(err('bad_request', 'events must be an array'), 400);
  }
  const seq = parseSequence(c.req.query('seq'));
  if (seq === undefined) return c.json(err('bad_request', 'invalid seq'), 400);
  return c.json(
    ok(await putReplayEvents(c.env, replay.id, seq, events as ReplayEvent[]))
  );
});

app.post('/api/replays/:replayId/finish', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    browserInfo?: Record<string, unknown>;
    videoDurationMs?: unknown;
  };
  const videoDurationMs = normalizeOptionalMs(body.videoDurationMs);
  const now = new Date().toISOString();
  const object = await getReplayObject(c.env, replay.id);
  const status = object ? 'ready' : 'upload_degraded';
  await c.env.DB.prepare(
    `update replays
     set finished_at = coalesce(finished_at, ?),
         recording_status = ?,
         browser_info_json = coalesce(?, browser_info_json),
         video_duration_ms = coalesce(?, video_duration_ms),
         updated_at = ?
     where id = ?`
  )
    .bind(
      now,
      status,
      body.browserInfo ? JSON.stringify(body.browserInfo) : null,
      videoDurationMs,
      now,
      replay.id
    )
    .run();
  return c.json(ok({replayId: replay.id, status}));
});

app.get('/api/replays/:replayId', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  return c.json(ok(replay));
});

app.get('/api/replays/:replayId/video', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const object = await getReplayObject(c.env, replay.id);
  if (!object) return c.json(err('not_found', 'video not found'), 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'video/webm',
      'cache-control': 'private, max-age=60',
    },
  });
});

app.get('/api/replays/:replayId/chunks', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const rows = await c.env.DB.prepare(
    'select seq, object_key, byte_size, started_at_ms, ended_at_ms from replay_chunks where replay_id = ? order by seq asc'
  )
    .bind(replay.id)
    .all();
  return c.json(ok(rows.results));
});

app.get('/api/replays/:replayId/chunks/:seq', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const seq = parseSequence(c.req.param('seq'));
  if (seq === undefined) return c.json(err('bad_request', 'invalid seq'), 400);
  const row = await c.env.DB.prepare(
    'select object_key from replay_chunks where replay_id = ? and seq = ?'
  )
    .bind(replay.id, seq)
    .first<{object_key: string}>();
  if (!row) return c.json(err('not_found', 'chunk not found'), 404);
  const object = await c.env.REPLAY_BUCKET.get(row.object_key);
  if (!object) return c.json(err('not_found', 'chunk not found'), 404);
  return new Response(object.body, {
    headers: {'content-type': object.httpMetadata?.contentType ?? 'video/webm'},
  });
});

app.get('/api/replays/:replayId/events', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const rows = await c.env.DB.prepare(
    'select event_id, type, at_ms, summary, visibility from replay_events_index where replay_id = ? order by at_ms asc'
  )
    .bind(replay.id)
    .all();
  return c.json(ok(rows.results));
});

app.get('/api/replays/:replayId/thumbnail', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const key = replay.thumbnail_object_key;
  if (!key) return c.json(err('not_found', 'thumbnail not found'), 404);
  const object = await c.env.REPLAY_BUCKET.get(key);
  if (!object) return c.json(err('not_found', 'thumbnail not found'), 404);
  return new Response(object.body, {
    headers: {'content-type': object.httpMetadata?.contentType ?? 'image/webp'},
  });
});

app.get('/api/replays/:replayId/comments', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const rows = await c.env.DB.prepare(
    'select id, at_ms, body, created_at from replay_comments where replay_id = ? order by at_ms asc'
  )
    .bind(replay.id)
    .all();
  return c.json(ok(rows.results));
});

app.post('/api/replays/:replayId/comments', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
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
  const id = `cmt_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'insert into replay_comments (id, replay_id, at_ms, body, created_at) values (?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      replay.id,
      Math.max(0, Math.floor(body.atMs)),
      body.body.trim(),
      now
    )
    .run();
  return c.json(
    ok({id, atMs: body.atMs, body: body.body.trim(), createdAt: now})
  );
});

app.post('/api/replays/:replayId/thumbnail', async (c) => {
  const replay = await getReplay(c.env, c.req.param('replayId'));
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);
  const key = replayThumbnailKey(replay.id);
  await c.env.REPLAY_BUCKET.put(key, c.req.raw.body ?? new ArrayBuffer(0), {
    httpMetadata: {contentType: 'image/webp'},
  });
  await c.env.DB.prepare(
    'update replays set thumbnail_object_key = ?, updated_at = ? where id = ?'
  )
    .bind(key, new Date().toISOString(), replay.id)
    .run();
  return c.json(ok({key}));
});

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const sandboxResponse = await proxyToSandbox(request, env);
    if (sandboxResponse) return sandboxResponse;
    return app.fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sweepStaleSessions(env));
  },
};

function ok<T>(data: T): ApiResult<T> {
  return {ok: true, data};
}

function err(code: string, message: string): ApiResult<never> {
  return {ok: false, error: {code, message}};
}

async function proxySession(c: WorkerContext, action: string, body?: unknown) {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) {
    return c.json(err('bad_request', 'sessionId is required'), 400);
  }
  if (!sessionActionsWithoutDbLookup.has(action)) {
    const record = await getSession(c.env, sessionId);
    if (!record) return c.json(err('not_found', 'session not found'), 404);
  }

  const id = c.env.SESSION_DO.idFromName(sessionId);
  const stub = c.env.SESSION_DO.get(id);
  const target = new URL(c.req.url);
  target.pathname = `/internal/sessions/${sessionId}/${action}`;
  const request =
    body === undefined
      ? new Request(target, c.req.raw)
      : new Request(target, {
          method: c.req.method === 'GET' ? 'POST' : c.req.method,
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
        });
  return stub.fetch(request);
}

async function proxySessionDelete(c: WorkerContext, action: string) {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) {
    return c.json(err('bad_request', 'sessionId is required'), 400);
  }
  const record = await getSession(c.env, sessionId);
  if (!record) return c.json(err('not_found', 'session not found'), 404);
  const id = c.env.SESSION_DO.idFromName(sessionId);
  const stub = c.env.SESSION_DO.get(id);
  const target = new URL(
    `https://session.internal/internal/sessions/${sessionId}/${action}`
  );
  return stub.fetch(new Request(target, {method: 'DELETE'}));
}

async function fetchSessionObject(
  env: Bindings,
  sessionId: string,
  action: string,
  body: unknown
) {
  const id = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(id);
  const target = new URL(
    `https://session.internal/internal/sessions/${encodeURIComponent(sessionId)}/${action}`
  );
  return stub.fetch(
    new Request(target, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    })
  );
}

interface SessionRow {
  id: string;
  scenario_id: string;
  replay_id: string;
}

interface ReplayRow {
  id: string;
  thumbnail_object_key: string | null;
}

async function getSession(env: Bindings, sessionId: string) {
  return env.DB.prepare('select * from play_sessions where id = ?')
    .bind(sessionId)
    .first<SessionRow>();
}

async function getReplay(env: Bindings, replayId: string) {
  return env.DB.prepare('select * from replays where id = ?')
    .bind(replayId)
    .first<ReplayRow>();
}

function parseSequence(value: string | undefined) {
  const raw = value ?? '0';
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 && number <= 999999
    ? number
    : undefined;
}

function parsePartNumber(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10000
    ? number
    : undefined;
}

function parseOptionalNumber(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeOptionalMs(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}
