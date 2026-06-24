import {pathToFileURL} from 'node:url';

export async function runDeploySmoke(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const scenarioId = options.scenarioId ?? 'demo-tutorial-001';

  async function request(path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    return {response, body};
  }

  async function testReady() {
    log('[deploy-smoke] GET /api/ready');
    const {response, body} = await request('/api/ready');
    assert(
      response.status === 200,
      `ready expected 200, got ${response.status}`
    );
    assertApiOk(body, 'ready');
  }

  async function createSession() {
    assert(
      options.turnstileToken,
      'INCIDENT_SMOKE_TURNSTILE_TOKEN is required'
    );
    log('[deploy-smoke] POST /api/sessions');
    const {response, body} = await request('/api/sessions', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({scenarioId, turnstileToken: options.turnstileToken}),
    });
    assert(
      response.status === 200,
      `session create expected 200, got ${response.status}`
    );
    const data = assertApiOk(body, 'session create');
    assert(typeof data.sessionId === 'string', 'sessionId missing');
    assert(typeof data.replayId === 'string', 'replayId missing');
    assert(typeof data.writeToken === 'string', 'writeToken missing');
    return data;
  }

  async function testReplayAccessPolicy(replayId, writeToken) {
    const replayPath = `/api/replays/${encodeURIComponent(replayId)}`;
    log('[deploy-smoke] GET replay without token');
    const denied = await request(replayPath);
    assert(
      denied.response.status === 401 || denied.response.status === 403,
      `private replay without token expected 401/403, got ${denied.response.status}`
    );

    log('[deploy-smoke] GET replay with write token');
    const allowed = await request(replayPath, {
      headers: {authorization: `Bearer ${writeToken}`},
    });
    assert(
      allowed.response.status === 200,
      `private replay with token expected 200, got ${allowed.response.status}`
    );
    assertApiOk(allowed.body, 'authorized replay read');
  }

  async function cleanupSession(sessionId, writeToken) {
    log('[deploy-smoke] DELETE smoke session');
    const {response} = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: {authorization: `Bearer ${writeToken}`},
      }
    );
    if (!response.ok) {
      warn(`[deploy-smoke] cleanup failed with status ${String(response.status)}`);
    }
  }

  log(`[deploy-smoke] target ${baseUrl}`);
  await testReady();
  if (options.readyOnly) {
    log('[deploy-smoke] ready-only check passed');
    return;
  }

  let created;
  try {
    created = await createSession();
    await testReplayAccessPolicy(created.replayId, created.writeToken);
  } finally {
    if (created) {
      await cleanupSession(created.sessionId, created.writeToken);
    }
  }
  log('[deploy-smoke] all checks passed');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertApiOk(payload, context) {
  assert(
    payload && typeof payload === 'object' && payload.ok === true,
    `${context} returned a non-ok API envelope`
  );
  return payload.data;
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  await runDeploySmoke({
    baseUrl: readRequiredEnv('INCIDENT_WORKER_URL'),
    turnstileToken: process.env.INCIDENT_SMOKE_TURNSTILE_TOKEN?.trim(),
    timeoutMs: Number(process.env.INCIDENT_SMOKE_TIMEOUT_MS ?? 15_000),
    scenarioId: process.env.INCIDENT_SMOKE_SCENARIO_ID,
    readyOnly: args.includes('--ready-only'),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
