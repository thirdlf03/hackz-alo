import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {createRouteHarness, json} from './helpers/routeHarness.mjs';

const {registerAdminRoutes} = await tsImport(
  '../../apps/worker/src/routes/adminRoutes.ts',
  import.meta.url
);

test('production admin route rejects requests without Access JWT or admin secret', async () => {
  const {app, env} = createAdminHarness({
    environment: 'production',
    adminSecret: 'top-secret',
  });

  const noCredentials = await app.fetch(featuredRequest({}), env);
  assert.equal(noCredentials.status, 401);

  const wrongSecret = await app.fetch(
    featuredRequest({'x-admin-secret': 'guess'}),
    env
  );
  assert.equal(wrongSecret.status, 401);
});

test('production admin route rejects the secret fallback when no secret is configured', async () => {
  const {app, env} = createAdminHarness({environment: 'production'});
  const response = await app.fetch(
    featuredRequest({'x-admin-secret': 'anything'}),
    env
  );
  assert.equal(response.status, 401);
});

test('admin secret and Access JWT both allow toggling the featured flag', async () => {
  const {app, env, replays} = createAdminHarness({
    environment: 'production',
    adminSecret: 'top-secret',
  });

  const viaSecret = await json(
    await app.fetch(
      featuredRequest({'x-admin-secret': 'top-secret'}, {featured: false}),
      env
    )
  );
  assert.equal(viaSecret.ok, true);
  assert.equal(viaSecret.data.featured, 0);
  assert.equal(replays.get('repl_1').featured, 0);

  const viaAccess = await json(
    await app.fetch(
      featuredRequest({'cf-access-jwt-assertion': 'jwt'}, {featured: true}),
      env
    )
  );
  assert.equal(viaAccess.ok, true);
  assert.equal(viaAccess.data.featured, 1);
  assert.equal(replays.get('repl_1').featured, 1);
});

test('non-production admin route works without credentials and 404s on unknown replay', async () => {
  const {app, env} = createAdminHarness({});

  const updated = await json(
    await app.fetch(featuredRequest({}, {featured: true}), env)
  );
  assert.equal(updated.ok, true);

  const missing = await app.fetch(
    new Request('http://test/api/admin/replays/repl_missing/featured', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{}',
    }),
    env
  );
  assert.equal(missing.status, 404);
});

function featuredRequest(headers, body = {}) {
  return new Request('http://test/api/admin/replays/repl_1/featured', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

function createAdminHarness({environment, adminSecret}) {
  const replays = new Map([['repl_1', {id: 'repl_1', featured: 1}]]);
  const env = {
    ENVIRONMENT: environment,
    ADMIN_SECRET: adminSecret,
    DB: {
      prepare(sql) {
        return {
          binds: [],
          bind(...values) {
            this.binds = values;
            return this;
          },
          async first() {
            if (sql.includes('select id from replays')) {
              const replay = replays.get(this.binds[0]);
              return replay ? {id: replay.id} : null;
            }
            return null;
          },
          async run() {
            if (sql.includes('update replays set featured')) {
              const [featured, , replayId] = this.binds;
              const replay = replays.get(replayId);
              if (replay) replay.featured = featured;
            }
            return {};
          },
        };
      },
    },
  };
  const app = createRouteHarness(env);
  registerAdminRoutes(app);
  return {app, env, replays};
}
