import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {pathToFileURL, fileURLToPath} from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const {runDeploySmoke} = await import(
  pathToFileURL(path.join(rootDir, 'scripts/deploy-smoke.mjs')).href
);

test('deploy smoke checks ready, session create, replay access, and cleanup', async () => {
  const requests = [];
  await runDeploySmoke({
    baseUrl: 'https://worker.example.test',
    turnstileToken: 'test-turnstile-token',
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      requests.push({
        method: init.method ?? 'GET',
        pathname: parsed.pathname,
        authorization: init.headers?.authorization,
        body: init.body,
      });

      if (parsed.pathname === '/api/ready') {
        return jsonResponse(200, {ok: true, data: {status: 'ready'}});
      }
      if (parsed.pathname === '/api/sessions') {
        const body = JSON.parse(init.body);
        assert.equal(body.turnstileToken, 'test-turnstile-token');
        return jsonResponse(200, {
          ok: true,
          data: {
            sessionId: 'sess_smoke',
            replayId: 'repl_smoke',
            writeToken: 'write-token',
          },
        });
      }
      if (parsed.pathname === '/api/replays/repl_smoke') {
        if (init.headers?.authorization === 'Bearer write-token') {
          return jsonResponse(200, {ok: true, data: {id: 'repl_smoke'}});
        }
        return jsonResponse(401, {
          ok: false,
          error: {code: 'unauthorized', message: 'token required'},
        });
      }
      if (parsed.pathname === '/api/sessions/sess_smoke') {
        assert.equal(init.method, 'DELETE');
        assert.equal(init.headers?.authorization, 'Bearer write-token');
        return jsonResponse(200, {ok: true, data: {deleted: true}});
      }
      return jsonResponse(404, {
        ok: false,
        error: {code: 'not_found', message: 'not found'},
      });
    },
    log: () => undefined,
    warn: () => undefined,
  });

  assert.deepEqual(
    requests.map((request) => [request.method, request.pathname]),
    [
      ['GET', '/api/ready'],
      ['POST', '/api/sessions'],
      ['GET', '/api/replays/repl_smoke'],
      ['GET', '/api/replays/repl_smoke'],
      ['DELETE', '/api/sessions/sess_smoke'],
    ]
  );
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}
