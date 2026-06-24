import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {sweepStaleSessions} = await tsImport(
  '../../apps/worker/src/sessionSweep.ts',
  import.meta.url
);

test('sweepStaleSessions logs structured candidate, cleanup, and failure counts', async () => {
  const fetches = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async all() {
            if (sql.includes("status = 'running'")) {
              return {results: [{id: 'sess_running'}]};
            }
            return {
              results: [
                {id: 'sess_stale'},
                {id: 'sess_running'},
                {id: 'sess_fail'},
              ],
            };
          },
        };
      },
    },
    SESSION_DO: {
      idFromName(sessionId) {
        return sessionId;
      },
      get(sessionId, options) {
        return {
          async fetch(request) {
            const pathname = new URL(request.url).pathname;
            fetches.push({
              sessionId,
              pathname,
              method: request.method,
              locationHint: options.locationHint,
            });
            if (sessionId === 'sess_fail') {
              throw new Error('durable object unavailable');
            }
            if (sessionId === 'sess_stale' && pathname.endsWith('/timeout')) {
              return new Response('', {status: 500});
            }
            return new Response('{}', {status: 200});
          },
        };
      },
    },
  };

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => {
    logs.push(JSON.parse(line));
  };
  try {
    assert.equal(await sweepStaleSessions(env), 2);
  } finally {
    console.log = originalLog;
  }

  assert.equal(
    fetches.every((fetch) => fetch.locationHint === 'apac-ne'),
    true
  );
  assert.equal(
    fetches.some(
      (fetch) =>
        fetch.sessionId === 'sess_stale' && fetch.pathname.endsWith('/delete')
    ),
    true
  );
  assert.deepEqual(
    logs.find((log) => log.event === 'session_sweep'),
    {
      event: 'session_sweep',
      at: logs.find((log) => log.event === 'session_sweep')?.at,
      runningCandidates: 1,
      staleCandidates: 3,
      candidates: 3,
      cleaned: 2,
      failed: 1,
    }
  );
  assert.equal(
    logs.some(
      (log) =>
        log.event === 'session_sweep_failed' &&
        log.sessionId === 'sess_fail' &&
        /durable object unavailable/.test(log.message)
    ),
    true
  );
});
