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
import {generateIceServers} from '../effect/cloudflareTurn.js';
import {sendPagerNotification} from '../effect/pagerPush.js';
import {buildPagerNotificationPayload} from '../pure/pagerNotification.js';
import {upsertPagerSubscription} from '../repositories/pagerSubscriptionRepository.js';
import {createSessionProxyRequest} from '../http/sessionProxyRequest.js';

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
  'exercise',
  'participant-cursor',
  'terminal',
  'terminal-resize',
  'signal',
]);
const SESSION_CREATE_BODY_MAX_BYTES = 8 * 1024;
const SESSION_CONTROL_BODY_MAX_BYTES = 8 * 1024;
const SESSION_FILE_BODY_MAX_BYTES = 1024 * 1024;
const SESSION_PAGER_BODY_MAX_BYTES = 4096;
const RTC_SIGNAL_BODY_MAX_BYTES = 64 * 1024;
const SESSION_READ_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
      participantId?: string;
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
        ...(typeof body.participantId === 'string'
          ? {participantId: body.participantId}
          : {}),
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
    const parsedBody = await readRouteJsonObject(
      c,
      SESSION_CONTROL_BODY_MAX_BYTES,
      {emptyValue: {}}
    );
    if (parsedBody instanceof Response) return parsedBody;
    const body = parsedBody as {participantId?: string};
    const response = await proxySession(c, 'start', {
      sessionId,
      replayId: record.replay_id,
      scenarioId: record.scenario_id,
      originUrl: new URL(c.req.url).origin,
      ...(typeof body.participantId === 'string'
        ? {participantId: body.participantId}
        : {}),
    });
    if (response.ok) {
      scheduleSessionPagerAlerts(c, sessionId, record.scenario_id);
    }
    return response;
  });
  app.post('/api/sessions/:sessionId/read-tokens', async (c) => {
    const sessionId = c.req.param('sessionId');
    const denied = await requireSessionWriteAccess(c, sessionId);
    if (denied) return denied;
    const record = await getSession(c.env, sessionId);
    if (!record) return c.json(err('not_found', 'session not found'), 404);
    const readToken = createWriteToken();
    const tokenHash = await hashWriteToken(readToken);
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + SESSION_READ_TOKEN_TTL_MS
    ).toISOString();
    await c.env.DB.prepare(
      `insert into session_read_tokens (id, session_id, token_hash, scope, expires_at, created_at)
       values (?, ?, ?, 'read', ?, ?)`
    )
      .bind(
        `rtok_${crypto.randomUUID().replaceAll('-', '')}`,
        sessionId,
        tokenHash,
        expiresAt,
        now
      )
      .run();
    return c.json(ok({readToken}));
  });
  app.post('/api/sessions/:sessionId/pager', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const sessionId = c.req.param('sessionId');
    const parsedBody = await readRouteJsonObject(
      c,
      SESSION_PAGER_BODY_MAX_BYTES,
      {emptyValue: {}}
    );
    if (parsedBody instanceof Response) return parsedBody;
    const body = parsedBody as {
      endpoint?: string;
      expirationTime?: number | null;
      keys?: {p256dh?: string; auth?: string};
    };
    if (typeof body.endpoint !== 'string' || body.endpoint.length === 0) {
      return c.json(err('bad_request', 'endpoint is required'), 400);
    }
    if (
      !body.keys ||
      typeof body.keys.p256dh !== 'string' ||
      typeof body.keys.auth !== 'string'
    ) {
      return c.json(
        err('bad_request', 'keys.p256dh and keys.auth are required'),
        400
      );
    }
    await upsertPagerSubscription(c.env, {
      sessionId,
      endpoint: body.endpoint,
      subscriptionJson: JSON.stringify(body),
      createdAt: Date.now(),
    });
    return c.json(ok({registered: true}));
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

  app.get('/api/sessions/:sessionId/exercise', async (c) =>
    proxySessionRead(c, 'exercise')
  );
  app.post('/api/sessions/:sessionId/participants/join', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'participant-join', body);
  });
  app.post('/api/sessions/:sessionId/participants/heartbeat', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'participant-heartbeat', body);
  });
  app.post('/api/sessions/:sessionId/participants/cursor', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'participant-cursor', body);
  });
  app.post('/api/sessions/:sessionId/participants/role', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'participant-role', body);
  });
  app.post('/api/sessions/:sessionId/participants/leave', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'participant-leave', body);
  });
  app.post('/api/sessions/:sessionId/exercise/ready', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'exercise-ready', body);
  });
  app.post('/api/sessions/:sessionId/tasks', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'task-create', body);
  });
  app.post('/api/sessions/:sessionId/tasks/:taskId/update', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'task-update', {
      ...body,
      taskId: c.req.param('taskId'),
    });
  });
  app.post('/api/sessions/:sessionId/injects/:injectId/fire', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'inject-fire', {
      ...body,
      injectId: c.req.param('injectId'),
    });
  });
  app.post('/api/sessions/:sessionId/exercise/phase', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'phase', body);
  });
  app.post('/api/sessions/:sessionId/incident-log', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'incident-log', body);
  });
  app.post('/api/sessions/:sessionId/hotwash', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'hotwash', body);
  });
  app.get('/api/sessions/:sessionId/aar', async (c) =>
    proxySessionRead(c, 'aar')
  );
  app.post('/api/sessions/:sessionId/rtc/turn-credentials', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    const record = await getSession(c.env, c.req.param('sessionId'));
    if (!record) return c.json(err('not_found', 'session not found'), 404);
    const body = await readRouteJsonObject(c, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return c.json(ok({iceServers: await generateIceServers(c.env)}));
  });
  app.post('/api/sessions/:sessionId/rtc/signal', async (c) => {
    const denied = await requireSessionWriteAccess(c, c.req.param('sessionId'));
    if (denied) return denied;
    // SDP オファーを含むため、通常の制御ボディより大きめの上限を許す。
    const body = await readRouteJsonObject(c, RTC_SIGNAL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
    if (body instanceof Response) return body;
    return proxySession(c, 'signal', body);
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
  const request = createSessionProxyRequest(c.req.raw, target, body);
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

function scheduleSessionPagerAlerts(
  c: WorkerContext,
  sessionId: string,
  scenarioId: string
) {
  const scenario = getScenario(scenarioId);
  if (!scenario) return;
  const origin = new URL(c.req.url).origin;
  const payload = buildPagerNotificationPayload(
    scenario,
    `${origin}/`,
    sessionId
  );
  c.executionCtx.waitUntil(
    sendPagerNotification(c.env, sessionId, payload).catch((error: unknown) => {
      logStructured('pager_alerts_failed', {
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
