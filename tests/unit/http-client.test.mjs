import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {HttpClient} = await tsImport(
  '../../apps/web/src/api/httpClient.ts',
  import.meta.url
);
const {initBrowserPerf, resetBrowserPerfForTests, snapshotBrowserPerf} =
  await tsImport('@incident/observability/browser', import.meta.url);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

test('HttpClient parses ok API envelopes for GET and POST', async () => {
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({path, init});
    if (path === '/api/scenarios') {
      return jsonResponse({ok: true, data: [{id: 'demo'}]});
    }
    if (path === '/api/sessions') {
      return jsonResponse({ok: true, data: {sessionId: 's1'}});
    }
    throw new Error(`unexpected path ${path}`);
  };

  const http = new HttpClient();
  const scenarios = await http.get('/api/scenarios');
  assert.deepEqual(scenarios, [{id: 'demo'}]);
  assert.equal(calls[0]?.init?.method, 'GET');

  await http.post('/api/sessions', {scenarioId: 'demo'});
  assert.equal(calls[1]?.init?.method, 'POST');
  assert.match(String(calls[1]?.init?.headers?.['content-type']), /json/);
  assert.equal(calls[1]?.init?.body, JSON.stringify({scenarioId: 'demo'}));
});

test('HttpClient throws API errors and supports DELETE envelopes', async () => {
  globalThis.fetch = async (path, init) => {
    if (init?.method === 'DELETE') {
      return jsonResponse({ok: false, error: {message: 'gone'}});
    }
    return jsonResponse({ok: false, error: {message: 'bad'}});
  };

  const http = new HttpClient();
  await assert.rejects(() => http.get('/api/broken'), /bad/);
  await assert.rejects(
    () => http.request('/api/sessions/s1', {method: 'DELETE'}),
    /gone/
  );
});

test('HttpClient supports successful DELETE, PUT, and request envelopes', async () => {
  globalThis.fetch = async (path, init) => {
    if (init?.method === 'DELETE') {
      return jsonResponse({ok: true, data: {deleted: true}});
    }
    if (init?.method === 'PUT') {
      return jsonResponse({ok: true, data: {path: '/file', byteLength: 4}});
    }
    throw new Error(`unexpected ${init?.method} ${path}`);
  };

  const http = new HttpClient();
  const deleted = await http.request('/api/sessions/s1', {method: 'DELETE'});
  assert.deepEqual(deleted, {deleted: true});
  const updated = await http.put('/api/sessions/s1/file', {
    path: '/file',
    content: 'ok',
  });
  assert.deepEqual(updated, {path: '/file', byteLength: 4});
});

test('HttpClient.fetch delegates to global fetch', async () => {
  globalThis.fetch = async () => new Response('ok', {status: 200});
  const http = new HttpClient();
  const response = await http.fetch('/raw');
  assert.equal(response.status, 200);
});

test('HttpClient attaches stored token to protected replay and session requests', async () => {
  const calls = [];
  globalThis.sessionStorage = memorySessionStorage();
  globalThis.fetch = async (path, init) => {
    calls.push({
      path,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return jsonResponse({ok: true, data: {}});
  };

  const http = new HttpClient();
  http.setWriteToken('writer-token');
  await http.get('/api/replays/repl_1');
  await http.fetch('/api/replays/repl_1/video', {method: 'HEAD'});
  await http.get('/api/sessions/sess_1/clock');
  await http.get('/api/replays/featured');
  await http.get('/api/scenarios');

  assert.deepEqual(
    calls.map((call) => call.authorization),
    [
      'Bearer writer-token',
      'Bearer writer-token',
      'Bearer writer-token',
      null,
      null,
    ]
  );
  delete globalThis.sessionStorage;
});

test('HttpClient uses replay read token from page URL when no write token exists', async () => {
  const calls = [];
  delete globalThis.sessionStorage;
  globalThis.window = {location: {search: '?readToken=reader-token'}};
  globalThis.fetch = async (path, init) => {
    calls.push({
      path,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return jsonResponse({ok: true, data: {}});
  };

  const http = new HttpClient();
  await http.get('/api/replays/repl_1');
  await http.get('/api/sessions/sess_1/clock');

  assert.deepEqual(
    calls.map((call) => call.authorization),
    ['Bearer reader-token', null]
  );
  delete globalThis.window;
});

test('HttpClient reads the latest browser write token across client instances', async () => {
  const calls = [];
  globalThis.sessionStorage = memorySessionStorage();
  globalThis.fetch = async (path, init) => {
    calls.push({
      path,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return jsonResponse({ok: true, data: {}});
  };

  const first = new HttpClient();
  const second = new HttpClient();
  first.setWriteToken('old-writer-token');
  second.setWriteToken('new-writer-token');

  await first.get('/api/sessions/sess_1/clock');

  assert.equal(calls[0]?.authorization, 'Bearer new-writer-token');
  delete globalThis.sessionStorage;
});

test('HttpClient scopes URL read token to read access for the linked replay', async () => {
  const calls = [];
  globalThis.sessionStorage = memorySessionStorage();
  globalThis.window = {
    location: {search: '?replay=repl_shared&readToken=reader-token'},
  };
  globalThis.fetch = async (path, init) => {
    calls.push({
      path,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return jsonResponse({ok: true, data: {}});
  };

  const http = new HttpClient();
  http.setWriteToken('writer-token');
  await http.get('/api/replays/repl_shared');
  await http.post('/api/replays/repl_shared/comments', {atMs: 0, body: 'ok'});
  await http.post('/api/replays/repl_shared/share-links', {});
  await http.get('/api/replays/repl_other');
  await http.get('/api/sessions/sess_1/clock');

  assert.deepEqual(
    calls.map((call) => call.authorization),
    [
      'Bearer reader-token',
      'Bearer reader-token',
      'Bearer writer-token',
      'Bearer writer-token',
      'Bearer writer-token',
    ]
  );
  delete globalThis.window;
  delete globalThis.sessionStorage;
});

test('HttpClient injects traceparent when browser perf is enabled', async () => {
  resetBrowserPerfForTests();
  initBrowserPerf({enabled: true, exporter: 'memory'});
  let traceparent = '';
  globalThis.fetch = async (_path, init) => {
    traceparent = new Headers(init?.headers).get('traceparent') ?? '';
    return jsonResponse({ok: true, data: {ok: true}});
  };

  const http = new HttpClient();
  await http.get('/api/perf-check');

  assert.match(traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.equal(
    snapshotBrowserPerf().spans.at(-1)?.name,
    'incident.app.api.request'
  );
  resetBrowserPerfForTests();
});

function memorySessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
