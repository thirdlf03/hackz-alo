import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  createPerfController,
  frameStats,
  INCIDENT_SPAN_NAMES,
  MemoryPerfSink,
  noopPerfController,
  parseTraceparent,
} = await tsImport(
  '../../packages/observability/src/core/index.ts',
  import.meta.url
);

test('disabled perf path is a no-op', () => {
  const span = noopPerfController.startSpan('incident.app.test');
  assert.equal(span.end(), undefined);
  assert.equal(noopPerfController.snapshot().spans.length, 0);
});

test('memory exporter records spans with W3C trace context', async () => {
  const sink = new MemoryPerfSink();
  const perf = createPerfController(
    {
      enabled: true,
      runtime: 'browser',
      serviceName: 'test',
      exporter: 'memory',
    },
    sink
  );

  await perf.withSpan(
    INCIDENT_SPAN_NAMES.apiRequest,
    {attributes: {route: '/api/test'}},
    async (span) => {
      assert.ok(parseTraceparent(span.traceparent));
    }
  );

  const snapshot = perf.snapshot();
  assert.equal(snapshot.spans.length, 1);
  assert.equal(snapshot.spans[0].name, INCIDENT_SPAN_NAMES.apiRequest);
  assert.equal(snapshot.spans[0].attributes.route, '/api/test');
});

test('frame stats compute p95 draw samples', () => {
  const stats = frameStats([
    sample(10, 0),
    sample(20, 16),
    sample(80, 32),
    sample(30, 48),
  ]);
  assert.equal(stats.lastDrawMs, 30);
  assert.equal(stats.p95DrawMs, 80);
  assert.equal(stats.slowDrawCount, 1);
});

function sample(drawMs, timestampUnixMs) {
  return {
    schemaVersion: 1,
    type: 'frame',
    runtime: 'browser',
    serviceName: 'test',
    timestampUnixMs,
    drawMs,
  };
}
