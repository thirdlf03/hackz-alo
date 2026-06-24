import {getRandomScenarioByDifficulty, getScenario} from '@incident/scenarios';
import type {Difficulty} from '@incident/shared';
import {traceHeaders} from '@incident/observability/worker';
import type {WorkerApp, WorkerContext} from '../http/context.js';
import {readRouteJsonObject} from '../http/routeBody.js';
import {enforceRateLimit, shouldEnforceRateLimit} from '../http/rateLimit.js';
import {logStructured} from '../http/requestLog.js';
import {requireSessionReadAccess} from '../http/sessionReadPolicy.js';
import {verifyTurnstileToken} from '../http/turnstile.js';
import {requireSessionWriteAccess} from '../http/writeAuthMiddleware.js';
import {err, messageFrom, ok} from '../http/response.js';
import {createWriteToken, hashWriteToken} from '../pure/writeAuth.js';
import {purgeReplayStorage} from '../storage/replayPurge.js';
import type {Bindings} from '../types.js';
import {getSessionDoStub} from '../effect/sessionDoStub.js';

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
const SESSION_CREATE_BODY_MAX_BYTES = 8 * 1024;
const SESSION_CONTROL_BODY_MAX_BYTES = 8 * 1024;
const SESSION_FILE_BODY_MAX_BYTES = 1024 * 1024;

export function registerSessionRoutes(app: WorkerApp) {
  app.post('/api/sessions', async (c) => {
    const clientIp = c.req.header('cf-connecting-ip') ?? 'unknown';
    if (shouldEnforceRateLimit(c.env)) {
      const limited = await enforceRateLimit(
        c.env,
        `sessions:${clientIp}`,
        5,
        60
      );
      if (!limited.allowed) {
        logStructured('rate_limit_hit', {
          route: 'POST /api/sessions',
          clientIp,
        });
        c.header('Retry-After', String(limited.retryAfter));
        return c.json(err('rate_limited', 'too many session creations'), 429);
      }
    }

    const parsedBody = await readRouteJsonObject(
      c,
      SESSION_CREATE_BODY_MAX_BYTES,
      {
        emptyValue: {},
      }
    );
    if (parsedBody instanceof Response) return parsedBody;
    const body = parsedBody as {
      scenarioId?: string;
      difficulty?: string;
      turnstileToken?: string;
    };
    if (!(await verifyTurnstileToken(c.env, body.turnstileToken, clientIp))) {
      return c.json(err('forbidden', 'turnstile verification failed'), 403);
    }
    const scenario = resolveRequestedScenario(body);
    if (!scenario) {
      return c.json(
        err('bad_request', 'scenarioId or difficulty is required'),
        400
      );
    }

    const sessionId = `sess_${crypto.randomUUID().replaceAll('-', '')}`;
    const replayId = `repl_${crypto.randomUUID().replaceAll('-', '')}`;
    const writeToken = createWriteToken();
    const writeTokenHash = await hashWriteToken(writeToken);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `insert into play_sessions
       (id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at, write_token_hash)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        scenario.id,
        scenario.version,
        `session-${sessionId}`,
        replayId,
        'created',
        now,
        writeTokenHash
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
    scheduleSessionPrepare(c, sessionId, {
      sessionId,
      replayId,
      scenarioId: scenario.id,
    });

    logStructured('session_created', {
      sessionId,
      replayId,
      scenarioId: scenario.id,
    });
    return c.json(ok({sessionId, replayId, writeToken, scenario}));
  });

  app.get('/api/sessions/:sessionId', async (c) =>
    proxySessionRead(c, 'snapshot')
  );
  app.post('/api/sessions/:sessionId/prepare', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const sessionId = c.req.param('sessionId');
    const record = await getSession(c.env, sessionId);
    if (!record) return c.json(err('not_found', 'session not found'), 404);
    return proxySession(c, 'prepare', {
      sessionId,
      replayId: record.replay_id,
      scenarioId: record.scenario_id,
    });
  });
  app.post('/api/sessions/:sessionId/start', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const sessionId = c.req.param('sessionId');
    const record = await getSession(c.env, sessionId);
    if (!record) return c.json(err('not_found', 'session not found'), 404);
    return proxySession(c, 'start', {
      sessionId,
      replayId: record.replay_id,
      scenarioId: record.scenario_id,
    });
  });
  app.post('/api/sessions/:sessionId/resolve', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    return proxySession(c, 'resolve');
  });
  app.post('/api/sessions/:sessionId/retire', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    return proxySession(c, 'retire');
  });
  app.post('/api/sessions/:sessionId/timeout', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    return proxySession(c, 'timeout');
  });
  app.delete('/api/sessions/:sessionId', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    return proxySessionDelete(c, 'delete');
  });
  app.get('/api/sessions/:sessionId/events', async (c) =>
    proxySessionRead(c, 'events')
  );
  app.get('/api/sessions/:sessionId/clock', async (c) =>
    proxySessionRead(c, 'clock')
  );
  app.post('/api/sessions/:sessionId/clock', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'clock', body);
  });
  app.get('/api/sessions/:sessionId/metrics', async (c) =>
    proxySessionRead(c, 'metrics')
  );
  app.get('/api/sessions/:sessionId/logs', async (c) =>
    proxySessionRead(c, 'logs')
  );
  app.get('/api/sessions/:sessionId/storage', async (c) =>
    proxySessionRead(c, 'storage')
  );
  app.get('/api/sessions/:sessionId/files', async (c) =>
    proxySessionRead(c, 'files')
  );
  app.get('/api/sessions/:sessionId/file', async (c) =>
    proxySessionRead(c, 'file')
  );
  app.put('/api/sessions/:sessionId/file', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_FILE_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'file', body);
  });
  app.get('/api/sessions/:sessionId/ws/terminal', async (c) =>
    proxySessionRead(c, 'terminal')
  );
  app.post('/api/sessions/:sessionId/terminal/interrupt', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    return proxySession(c, 'terminal-interrupt');
  });
  app.post('/api/sessions/:sessionId/terminal/resize', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'terminal-resize', body);
  });
}

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

async function proxySessionRead(c: WorkerContext, action: string) {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) {
    return c.json(err('bad_request', 'sessionId is required'), 400);
  }
  const denied = await requireSessionReadAccess(c, sessionId);
  if (denied) return denied;
  return proxySession(c, action);
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

  const stub = getSessionDoStub(c.env.SESSION_DO, sessionId);
  const target = new URL(c.req.url);
  target.pathname = `/internal/sessions/${sessionId}/${action}`;
  const request =
    body === undefined
      ? new Request(new Request(target, c.req.raw), {
          headers: traceHeaders(c.req.raw.headers),
        })
      : new Request(target, {
          method: c.req.method === 'GET' ? 'POST' : c.req.method,
          headers: traceHeaders({'content-type': 'application/json'}),
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
  const replayId = record.replay_id;
  const stub = getSessionDoStub(c.env.SESSION_DO, sessionId);
  const target = new URL(
    `https://session.internal/internal/sessions/${sessionId}/${action}`
  );
  const response = await stub.fetch(
    new Request(target, {method: 'DELETE', headers: traceHeaders()})
  );
  if (response.ok && replayId) {
    await purgeReplayStorage(c.env, replayId).catch(() => undefined);
  }
  return response;
}

async function fetchSessionObject(
  env: Bindings,
  sessionId: string,
  action: string,
  body: unknown
) {
  const stub = getSessionDoStub(env.SESSION_DO, sessionId);
  const target = new URL(
    `https://session.internal/internal/sessions/${encodeURIComponent(sessionId)}/${action}`
  );
  return stub.fetch(
    new Request(target, {
      method: 'POST',
      headers: traceHeaders({'content-type': 'application/json'}),
      body: JSON.stringify(body),
    })
  );
}

function scheduleSessionPrepare(
  c: WorkerContext,
  sessionId: string,
  body: SessionBootstrapBody
) {
  c.executionCtx.waitUntil(
    fetchSessionObject(c.env, sessionId, 'prepare', body)
      .then(async (response) => {
        if (response.ok) return;
        logStructured('session_prepare_failed', {
          sessionId,
          status: response.status,
          response: truncateLogValue(await response.text().catch(() => '')),
        });
      })
      .catch((error: unknown) => {
        logStructured('session_prepare_failed', {
          sessionId,
          message: messageFrom(error),
        });
      })
  );
}

interface SessionBootstrapBody {
  sessionId: string;
  replayId: string;
  scenarioId: string;
}

function truncateLogValue(value: string) {
  return value.length > 300 ? `${value.slice(0, 300)}...` : value;
}

interface SessionRow {
  id: string;
  scenario_id: string;
  replay_id: string;
}

async function getSession(env: Bindings, sessionId: string) {
  return env.DB.prepare(
    `select id, scenario_id, replay_id
     from play_sessions
     where id = ?`
  )
    .bind(sessionId)
    .first<SessionRow>();
}
