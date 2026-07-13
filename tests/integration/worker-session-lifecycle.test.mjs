import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {createRouteHarness, json} from './helpers/routeHarness.mjs';

const {registerSessionRoutes} = await tsImport(
  '../../apps/worker/src/routes/sessionRoutes.ts',
  import.meta.url
);

test('session create persists rows, returns write token, and bootstraps the Durable Object', async () => {
  const {app, env, state} = createSessionHarness();

  const created = await json(
    await app.fetch(createSessionRequest({difficulty: 'beginner'}), env)
  );
  assert.equal(created.ok, true);
  assert.match(created.data.sessionId, /^sess_[0-9a-f]{32}$/);
  assert.match(created.data.replayId, /^repl_[0-9a-f]{32}$/);
  assert.equal(typeof created.data.writeToken, 'string');
  assert.equal(created.data.scenario.difficulty, 'beginner');

  const sessionRow = state.playSessions.get(created.data.sessionId);
  assert.ok(sessionRow, 'play_sessions row inserted');
  assert.equal(sessionRow.replay_id, created.data.replayId);
  assert.equal(sessionRow.status, 'created');
  assert.ok(sessionRow.write_token_hash);
  assert.ok(state.replays.has(created.data.replayId), 'replays row inserted');

  const bootstrap = state.doCalls.find((call) =>
    call.path.endsWith('/bootstrap')
  );
  assert.ok(bootstrap, 'Durable Object bootstrap called');
  assert.equal(bootstrap.sessionId, created.data.sessionId);
  assert.equal(JSON.parse(bootstrap.body).scenarioId, created.data.scenario.id);

  await app.flushBackground();
  assert.ok(
    state.doCalls.some((call) => call.path.endsWith('/prepare')),
    'background prepare scheduled after create'
  );
});

test('session create validates scenario input', async () => {
  const {app, env} = createSessionHarness();

  const missing = await app.fetch(createSessionRequest({}), env);
  assert.equal(missing.status, 400);

  const unknownScenario = await app.fetch(
    createSessionRequest({scenarioId: 'no-such-scenario-999'}),
    env
  );
  assert.equal(unknownScenario.status, 400);

  const unknownDifficulty = await app.fetch(
    createSessionRequest({difficulty: 'nightmare'}),
    env
  );
  assert.equal(unknownDifficulty.status, 400);
});

test('session control routes require the write token and proxy to the Durable Object', async () => {
  const {app, env, state} = createSessionHarness();
  const created = await json(
    await app.fetch(createSessionRequest({difficulty: 'beginner'}), env)
  );
  const sessionId = created.data.sessionId;

  const noAuth = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{}',
    }),
    env
  );
  assert.equal(noAuth.status, 401);

  const wrongToken = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer not-the-token',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
    env
  );
  assert.equal(wrongToken.status, 401);

  const started = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.data.writeToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }),
    env
  );
  assert.equal(started.status, 200);
  const start = state.doCalls.find((call) => call.path.endsWith('/start'));
  assert.ok(start, 'start proxied to Durable Object');
  assert.equal(start.sessionId, sessionId);
  assert.equal(JSON.parse(start.body).originUrl, 'http://test');

  const unknownSession = await app.fetch(
    new Request('http://test/api/sessions/sess_missing/start', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.data.writeToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }),
    env
  );
  assert.equal(unknownSession.status, 401);
});

test('issued read token grants read-only snapshot access with expiry enforced', async () => {
  const {app, env, state} = createSessionHarness();
  const created = await json(
    await app.fetch(createSessionRequest({difficulty: 'beginner'}), env)
  );
  const sessionId = created.data.sessionId;

  const anonymous = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}`),
    env
  );
  assert.equal(anonymous.status, 401);

  const issued = await json(
    await app.fetch(
      new Request(`http://test/api/sessions/${sessionId}/read-tokens`, {
        method: 'POST',
        headers: {authorization: `Bearer ${created.data.writeToken}`},
      }),
      env
    )
  );
  assert.equal(issued.ok, true);
  assert.equal(typeof issued.data.readToken, 'string');

  const snapshot = await app.fetch(
    new Request(
      `http://test/api/sessions/${sessionId}?readToken=${encodeURIComponent(issued.data.readToken)}`
    ),
    env
  );
  assert.equal(snapshot.status, 200);
  assert.ok(
    state.doCalls.some(
      (call) => call.path.endsWith('/snapshot') && call.sessionId === sessionId
    ),
    'snapshot proxied to Durable Object'
  );

  for (const tokenRow of state.readTokens) {
    tokenRow.expires_at = new Date(Date.now() - 1000).toISOString();
  }
  const expired = await app.fetch(
    new Request(
      `http://test/api/sessions/${sessionId}?readToken=${encodeURIComponent(issued.data.readToken)}`
    ),
    env
  );
  assert.equal(expired.status, 401);
});

test('session delete tears down the Durable Object and purges replay storage', async () => {
  const {app, env, state} = createSessionHarness();
  const created = await json(
    await app.fetch(createSessionRequest({difficulty: 'beginner'}), env)
  );
  const sessionId = created.data.sessionId;
  const replayId = created.data.replayId;

  const deleted = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {authorization: `Bearer ${created.data.writeToken}`},
    }),
    env
  );
  assert.equal(deleted.status, 200);
  assert.ok(
    state.doCalls.some(
      (call) => call.method === 'DELETE' && call.path.endsWith('/delete')
    ),
    'delete proxied to Durable Object'
  );
  assert.equal(state.replays.has(replayId), false, 'replay row purged');
  assert.ok(
    state.bucketDeletes.some((key) => key.includes(replayId)),
    'replay objects deleted from bucket'
  );
});

test('ws/terminal route forwards a real write-access decision and ignores a client-spoofed header', async () => {
  const {app, env, state} = createSessionHarness();
  const created = await json(
    await app.fetch(createSessionRequest({difficulty: 'beginner'}), env)
  );
  const sessionId = created.data.sessionId;
  const writeToken = created.data.writeToken;

  const withWriteToken = await app.fetch(
    new Request(
      `http://test/api/sessions/${sessionId}/ws/terminal?accessToken=${encodeURIComponent(writeToken)}`,
      {headers: {'x-incident-write-access': 'spoofed'}}
    ),
    env
  );
  assert.equal(withWriteToken.status, 200);
  const terminalCallWithWrite = state.doCalls.find((call) =>
    call.path.endsWith('/terminal')
  );
  assert.ok(terminalCallWithWrite, 'terminal proxied to Durable Object');
  assert.equal(terminalCallWithWrite.headers['x-incident-write-access'], '1');

  state.doCalls.length = 0;
  const issued = await json(
    await app.fetch(
      new Request(`http://test/api/sessions/${sessionId}/read-tokens`, {
        method: 'POST',
        headers: {authorization: `Bearer ${writeToken}`},
      }),
      env
    )
  );
  const withReadToken = await app.fetch(
    new Request(
      `http://test/api/sessions/${sessionId}/ws/terminal?accessToken=${encodeURIComponent(issued.data.readToken)}`,
      {headers: {'x-incident-write-access': '1'}}
    ),
    env
  );
  assert.equal(withReadToken.status, 200);
  const terminalCallWithRead = state.doCalls.find((call) =>
    call.path.endsWith('/terminal')
  );
  assert.ok(terminalCallWithRead, 'terminal proxied to Durable Object');
  assert.equal(terminalCallWithRead.headers['x-incident-write-access'], '0');

  state.doCalls.length = 0;
  const anonymous = await app.fetch(
    new Request(`http://test/api/sessions/${sessionId}/ws/terminal`),
    env
  );
  assert.equal(anonymous.status, 401);
  assert.equal(
    state.doCalls.some((call) => call.path.endsWith('/terminal')),
    false
  );
});

test('turnstile failure blocks session create when a secret is configured', async () => {
  const {app, env} = createSessionHarness({
    envOverrides: {TURNSTILE_SECRET_KEY: 'secret'},
  });
  const response = await app.fetch(
    createSessionRequest({difficulty: 'beginner'}),
    env
  );
  assert.equal(response.status, 403);
});

test('production rate limit rejects a burst of session creates from one client', async () => {
  const {app, env} = createSessionHarness({
    envOverrides: {ENVIRONMENT: 'production'},
  });
  const statuses = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await app.fetch(
      createSessionRequest({difficulty: 'beginner'}),
      env
    );
    statuses.push(response.status);
    if (response.status === 429) {
      assert.equal(response.headers.get('retry-after'), '60');
    }
  }
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[5], 429);
});

function createSessionRequest(body) {
  return new Request('http://test/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });
}

function createSessionHarness({envOverrides = {}} = {}) {
  const state = {
    playSessions: new Map(),
    replays: new Map(),
    readTokens: [],
    kv: new Map(),
    doCalls: [],
    bucketDeletes: [],
  };
  const env = {
    DB: fakeSessionDb(state),
    SESSION_DO: fakeSessionDoNamespace(state),
    SCENARIO_KV: {
      async get(key) {
        return state.kv.get(key) ?? null;
      },
      async put(key, value) {
        state.kv.set(key, value);
      },
    },
    REPLAY_BUCKET: {
      async list({prefix}) {
        return {
          objects: [{key: `${prefix}chunks/000000.webm`}],
          truncated: false,
        };
      },
      async delete(key) {
        state.bucketDeletes.push(key);
      },
    },
    ...envOverrides,
  };
  const app = createRouteHarness(env);
  registerSessionRoutes(app);
  return {app, env, state};
}

function fakeSessionDoNamespace(state) {
  return {
    idFromName(name) {
      return name;
    },
    get(sessionId) {
      return {
        async fetch(request) {
          const url = new URL(request.url);
          const body =
            request.method === 'GET' || request.method === 'DELETE'
              ? ''
              : await request.text();
          state.doCalls.push({
            sessionId,
            method: request.method,
            path: url.pathname,
            body,
            headers: Object.fromEntries(request.headers.entries()),
          });
          return new Response(JSON.stringify({ok: true, data: {}}), {
            headers: {'content-type': 'application/json'},
          });
        },
      };
    },
  };
}

function fakeSessionDb(state) {
  return {
    prepare(sql) {
      return {
        binds: [],
        bind(...values) {
          this.binds = values;
          return this;
        },
        async first() {
          if (
            sql.includes('from play_sessions') &&
            sql.includes('write_token_hash')
          ) {
            const row = state.playSessions.get(this.binds[0]);
            return row ? {write_token_hash: row.write_token_hash} : null;
          }
          if (sql.includes('from play_sessions')) {
            const row = state.playSessions.get(this.binds[0]);
            return row
              ? {
                  id: row.id,
                  scenario_id: row.scenario_id,
                  replay_id: row.replay_id,
                }
              : null;
          }
          if (sql.includes('from session_read_tokens')) {
            const [sessionId, tokenHash, now] = this.binds;
            const match = state.readTokens.find(
              (row) =>
                row.session_id === sessionId &&
                row.token_hash === tokenHash &&
                row.revoked_at === null &&
                row.expires_at > now
            );
            return match ? {token_hash: match.token_hash} : null;
          }
          return null;
        },
        async all() {
          return {results: []};
        },
        async run() {
          if (sql.includes('insert into play_sessions')) {
            const [
              id,
              scenarioId,
              scenarioVersion,
              sandboxId,
              replayId,
              status,
              createdAt,
              writeTokenHash,
            ] = this.binds;
            state.playSessions.set(id, {
              id,
              scenario_id: scenarioId,
              scenario_version: scenarioVersion,
              sandbox_id: sandboxId,
              replay_id: replayId,
              status,
              created_at: createdAt,
              write_token_hash: writeTokenHash,
            });
            return {};
          }
          if (sql.includes('insert into replays')) {
            const [id] = this.binds;
            state.replays.set(id, {id});
            return {};
          }
          if (sql.includes('insert into session_read_tokens')) {
            const [id, sessionId, tokenHash, expiresAt, createdAt] = this.binds;
            state.readTokens.push({
              id,
              session_id: sessionId,
              token_hash: tokenHash,
              expires_at: expiresAt,
              created_at: createdAt,
              revoked_at: null,
            });
            return {};
          }
          if (sql.includes('delete from replays where id = ?')) {
            state.replays.delete(this.binds[0]);
            return {};
          }
          return {};
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    },
  };
}
