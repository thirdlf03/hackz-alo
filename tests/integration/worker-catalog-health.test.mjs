import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {createRouteHarness, json} from './helpers/routeHarness.mjs';

const {registerScenarioRoutes} = await tsImport(
  '../../apps/worker/src/routes/scenarioRoutes.ts',
  import.meta.url
);
const {registerHealthRoutes} = await tsImport(
  '../../apps/worker/src/routes/healthRoutes.ts',
  import.meta.url
);
const {registerPushRoutes} = await tsImport(
  '../../apps/worker/src/routes/pushRoutes.ts',
  import.meta.url
);

test('scenario catalog lists scenarios and serves individual scenarios', async () => {
  const app = createRouteHarness({});
  registerScenarioRoutes(app);

  const listed = await json(
    await app.fetch(new Request('http://test/api/scenarios'))
  );
  assert.equal(listed.ok, true);
  assert.ok(listed.data.length > 0, 'catalog is not empty');
  for (const scenario of listed.data) {
    assert.equal(typeof scenario.id, 'string');
    assert.ok(
      ['beginner', 'intermediate', 'advanced'].includes(scenario.difficulty),
      `${scenario.id} has a known difficulty`
    );
  }

  const first = listed.data[0];
  const detail = await json(
    await app.fetch(new Request(`http://test/api/scenarios/${first.id}`))
  );
  assert.equal(detail.ok, true);
  assert.equal(detail.data.id, first.id);

  const missing = await app.fetch(
    new Request('http://test/api/scenarios/no-such-scenario-999')
  );
  assert.equal(missing.status, 404);
});

test('readiness reports healthy dependencies and degrades to 503 on failure', async () => {
  const healthyEnv = {
    DB: {
      prepare() {
        return {
          async first() {
            return {ok: 1};
          },
        };
      },
    },
    REPLAY_BUCKET: {
      async list() {
        return {objects: []};
      },
    },
  };
  const app = createRouteHarness(healthyEnv);
  registerHealthRoutes(app);

  const health = await json(
    await app.fetch(new Request('http://test/api/health'))
  );
  assert.equal(health.ok, true);
  assert.equal(health.data.status, 'ok');

  const ready = await json(
    await app.fetch(new Request('http://test/api/ready'))
  );
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.data, {status: 'ready', d1: true, r2: true});

  const brokenEnv = {
    DB: {
      prepare() {
        return {
          async first() {
            throw new Error('d1 unavailable');
          },
        };
      },
    },
    REPLAY_BUCKET: healthyEnv.REPLAY_BUCKET,
  };
  const notReady = await app.fetch(
    new Request('http://test/api/ready'),
    brokenEnv
  );
  assert.equal(notReady.status, 503);
  const body = await notReady.json();
  assert.equal(body.error.code, 'not_ready');
});

test('push public key endpoint disables pager UI when VAPID is not configured', async () => {
  const app = createRouteHarness({});
  registerPushRoutes(app);

  const disabled = await json(
    await app.fetch(new Request('http://test/api/push/public-key'), {})
  );
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.publicKey, null);

  const enabled = await json(
    await app.fetch(new Request('http://test/api/push/public-key'), {
      VAPID_PUBLIC_KEY: 'test-vapid-key',
    })
  );
  assert.equal(enabled.data.publicKey, 'test-vapid-key');
});
