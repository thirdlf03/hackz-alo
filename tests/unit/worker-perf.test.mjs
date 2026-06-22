import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  createWorkerPerf,
  instrumentD1,
  resetWorkerPerfForTests,
  serverTimingHeader,
  workerPerfSnapshot,
} = await tsImport(
  '../../packages/observability/src/worker/index.ts',
  import.meta.url
);

test('Server-Timing header uses app perf token', () => {
  assert.equal(
    serverTimingHeader(12.34),
    'incident_app;dur=12.3;desc="Incident app"'
  );
});

test('instrumentD1 records operation and statement summary without binds', async () => {
  resetWorkerPerfForTests();
  const perf = createWorkerPerf({INCIDENT_PERF: 'memory'});
  const db = instrumentD1(fakeD1(), perf);

  await db
    .prepare('select * from users where token = ?')
    .bind('secret-token')
    .first();

  const span = workerPerfSnapshot().spans.at(-1);
  assert.equal(span.name, 'incident.app.d1.query');
  assert.equal(span.attributes['db.operation'], 'SELECT');
  assert.equal(
    span.attributes['db.statement.summary'],
    'select * from users where token = ?'
  );
  assert.equal(JSON.stringify(span.attributes).includes('secret-token'), false);
  resetWorkerPerfForTests();
});

test('instrumentD1 does not stack proxies across middleware calls', async () => {
  resetWorkerPerfForTests();
  const perf = createWorkerPerf({INCIDENT_PERF: 'memory'});
  const rawDb = fakeD1();
  const once = instrumentD1(rawDb, perf);
  const twice = instrumentD1(once, perf);

  assert.equal(twice, once);

  await twice
    .prepare('select * from play_sessions where id = ?')
    .bind('s1')
    .first();

  const d1Spans = workerPerfSnapshot().spans.filter(
    (span) => span.name === 'incident.app.d1.query'
  );
  assert.equal(d1Spans.length, 1);
  assert.equal(d1Spans[0].attributes['db.operation'], 'SELECT');
  resetWorkerPerfForTests();
});

function fakeD1() {
  return {
    prepare(sql) {
      return fakeStatement(sql);
    },
    async batch(statements) {
      return statements.map(() => ({success: true}));
    },
  };
}

function fakeStatement(sql, binds = []) {
  return {
    bind(...values) {
      return fakeStatement(sql, values);
    },
    async first() {
      return {sql, bindCount: binds.length};
    },
    async run() {
      return {success: true};
    },
    async all() {
      return {results: []};
    },
    async raw() {
      return [];
    },
  };
}
