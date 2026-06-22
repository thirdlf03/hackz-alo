import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {HttpClient} = await tsImport(
  '../../apps/web/src/api/httpClient.ts',
  import.meta.url
);

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
