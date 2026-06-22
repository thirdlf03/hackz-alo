import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {bindApiMethods} = await tsImport(
  '../../apps/web/src/api/bindApiMethods.ts',
  import.meta.url
);
const {ApiClient, createApiClient} = await tsImport(
  '../../apps/web/src/api/client.ts',
  import.meta.url
);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

test('bindApiMethods copies bound methods onto a facade target', () => {
  const target = {};
  const source = {
    value: 1,
    greet(name) {
      return `${name}:${this.value}`;
    },
  };
  bindApiMethods(target, source, ['greet']);
  assert.equal(target.greet('player'), 'player:1');
});

test('ApiClient facade wraps createSession and delegates listScenarios', async () => {
  globalThis.fetch = async (path, init) => {
    if (path === '/api/scenarios') {
      return jsonResponse({ok: true, data: [{id: 'demo'}]});
    }
    if (path === '/api/sessions' && init?.method === 'POST') {
      return jsonResponse({
        ok: true,
        data: {
          sessionId: 'session-1',
          replayId: 'replay-1',
          scenario: {id: 'demo', title: 'Demo'},
        },
      });
    }
    throw new Error(`unexpected fetch ${path}`);
  };

  const client = new ApiClient();
  const scenarios = await client.listScenarios();
  assert.deepEqual(scenarios, [{id: 'demo'}]);

  const created = await client.createSession({scenarioId: 'demo'});
  assert.equal(created.sessionId, 'session-1');
  assert.equal(created.replayId, 'replay-1');
  assert.equal(created.scenario.id, 'demo');
});

test('createApiClient returns a typed facade surface', async () => {
  globalThis.fetch = async () => jsonResponse({ok: true, data: [{id: 'demo'}]});
  const client = createApiClient();
  const scenarios = await client.listScenarios();
  assert.deepEqual(scenarios, [{id: 'demo'}]);
});
