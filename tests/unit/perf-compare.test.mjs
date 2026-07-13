import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {comparePerfReports} = await tsImport(
  '../../packages/observability/src/node/index.ts',
  import.meta.url
);
const {INCIDENT_SPAN_NAMES} = await tsImport(
  '../../packages/observability/src/core/index.ts',
  import.meta.url
);

test('comparePerfReports flags sandbox span p95 regressions', () => {
  const baseline = reportWithSpan(INCIDENT_SPAN_NAMES.sandboxPrepare, 2000);
  const improved = reportWithSpan(INCIDENT_SPAN_NAMES.sandboxPrepare, 1500);
  const regressed = reportWithSpan(INCIDENT_SPAN_NAMES.sandboxPrepare, 3000);

  assert.equal(comparePerfReports(improved, baseline).ok, true);
  const result = comparePerfReports(regressed, baseline, {strict: true});
  assert.equal(result.ok, false);
  assert.match(result.findings.join('\n'), /sandbox\.prepare/);
});

test('comparePerfReports treats a missing baseline as ok in non-strict mode', () => {
  const current = reportWithSpan(INCIDENT_SPAN_NAMES.sandboxPrepare, 2000);
  const result = comparePerfReports(current, undefined);
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, ['baseline not provided']);
});

test('comparePerfReports fails when strict and baseline is missing', () => {
  const current = reportWithSpan(INCIDENT_SPAN_NAMES.sandboxPrepare, 2000);
  const result = comparePerfReports(current, undefined, {strict: true});
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, ['baseline not provided']);
});

function reportWithSpan(name, p95Ms) {
  return {
    generatedAt: new Date().toISOString(),
    spans: {
      count: 1,
      byName: [{name, count: 1, avgMs: p95Ms, p95Ms, maxMs: p95Ms}],
    },
    marks: [],
    frames: {count: 0, p95DrawMs: 0, slowDrawCount: 0},
    benchmarks: {},
  };
}
