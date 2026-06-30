import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {dispatchSessionRoute, matchSessionRoute} = await tsImport(
  '../../apps/worker/src/durable/sessionRouter.ts',
  import.meta.url
);

function stubHandlers(overrides = {}) {
  const routes = [
    'bootstrap',
    'prepare',
    'start',
    'resolve',
    'retire',
    'timeout',
    'delete',
    'updateClock',
    'terminalResize',
    'events',
    'clock',
    'metrics',
    'logs',
    'storage',
    'files',
    'readFile',
    'writeFile',
    'terminal',
    'terminalInterrupt',
    'participantJoin',
    'participantHeartbeat',
    'participantCursor',
    'participantRole',
    'participantLeave',
    'exerciseState',
    'exerciseReady',
    'taskCreate',
    'taskUpdate',
    'injectFire',
    'incidentLog',
    'hotwash',
    'aar',
    'snapshot',
  ];
  const handlers = Object.fromEntries(
    routes.map((route) => [
      route,
      async () => new Response(`stub:${route}`, {status: 500}),
    ])
  );
  return {...handlers, ...overrides};
}

test('matchSessionRoute maps durable object HTTP actions', () => {
  assert.equal(
    matchSessionRoute(
      new Request('https://do/start', {method: 'POST', body: '{}'})
    ),
    'start'
  );
  assert.equal(
    matchSessionRoute(
      new Request('https://do/prepare', {method: 'POST', body: '{}'})
    ),
    'prepare'
  );
  assert.equal(
    matchSessionRoute(new Request('https://do/events', {method: 'GET'})),
    'events'
  );
  assert.equal(
    matchSessionRoute(
      new Request('https://do/participant-join', {
        method: 'POST',
        body: '{}',
      })
    ),
    'participantJoin'
  );
  assert.equal(
    matchSessionRoute(new Request('https://do/exercise', {method: 'GET'})),
    'exerciseState'
  );
  assert.equal(
    matchSessionRoute(
      new Request('https://do/task-create', {method: 'POST', body: '{}'})
    ),
    'taskCreate'
  );
  assert.equal(
    matchSessionRoute(new Request('https://do/aar', {method: 'GET'})),
    'aar'
  );
  assert.equal(
    matchSessionRoute(
      new Request('https://do/file', {method: 'PUT', body: '{}'})
    ),
    'writeFile'
  );
  assert.equal(
    matchSessionRoute(new Request('https://do/session-id', {method: 'GET'})),
    'snapshot'
  );
  assert.equal(
    matchSessionRoute(new Request('https://do/unknown', {method: 'PATCH'})),
    undefined
  );
});

test('dispatchSessionRoute forwards requests to the matched handler', async () => {
  const seen = [];
  const response = await dispatchSessionRoute(
    new Request('https://do/timeout', {method: 'POST'}),
    stubHandlers({
      timeout: async (request) => {
        seen.push(request.method);
        return new Response('timed-out', {status: 200});
      },
    })
  );

  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), 'timed-out');
  assert.deepEqual(seen, ['POST']);
});

test('dispatchSessionRoute returns undefined for unknown routes', async () => {
  assert.equal(
    await dispatchSessionRoute(
      new Request('https://do/unknown', {method: 'PATCH'}),
      stubHandlers()
    ),
    undefined
  );
});
