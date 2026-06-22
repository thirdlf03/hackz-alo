import {getRandomScenarioByDifficulty, getScenario} from '@incident/scenarios';
import type {Difficulty} from '@incident/shared';
import type {WorkerApp, WorkerContext} from '../http/context.js';
import {err, ok} from '../http/response.js';
import type {Bindings} from '../types.js';

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

export function registerSessionRoutes(app: WorkerApp) {
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
  app.get('/api/sessions/:sessionId/logs', async (c) =>
    proxySession(c, 'logs')
  );
  app.get('/api/sessions/:sessionId/storage', async (c) =>
    proxySession(c, 'storage')
  );
  app.get('/api/sessions/:sessionId/files', async (c) =>
    proxySession(c, 'files')
  );
  app.get('/api/sessions/:sessionId/file', async (c) =>
    proxySession(c, 'file')
  );
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

async function getSession(env: Bindings, sessionId: string) {
  return env.DB.prepare('select * from play_sessions where id = ?')
    .bind(sessionId)
    .first<SessionRow>();
}
