import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {buildMetricSections, drawMetricsPanel} = await tsImport(
  '../../apps/web/src/game/render/canvasRenderMetrics.ts',
  import.meta.url
);

function mockCtx() {
  const state = {fillStyle: '', font: '', calls: []};
  return {
    state,
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    closePath() {},
    rect() {},
    clip() {},
    fill() {},
    fillRect() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    quadraticCurveTo() {},
    fillText(text, x, y) {
      state.calls.push({text, x, y});
    },
    measureText(text) {
      return {
        width: text.length * 8,
        actualBoundingBoxRight: text.length * 8,
      };
    },
    set font(value) {
      state.font = value;
    },
    get font() {
      return state.font;
    },
    set fillStyle(value) {
      state.fillStyle = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set strokeStyle(value) {},
    set lineWidth(value) {},
  };
}

function sampleMetrics(at = 1) {
  return {
    at,
    cpu: 92,
    memory: 88,
    disk: 81,
    http5xxRate: 0.12,
    latencyP95Ms: 1_600,
    rps: 42,
    dbConnections: 28,
    queueDepth: 18,
  };
}

test('buildMetricSections groups metrics into resource, traffic, and datastore cards', () => {
  const sections = buildMetricSections({
    metrics: sampleMetrics(),
    edgeRttMs: null,
    edgeRttHistory: [],
  });

  assert.deepEqual(
    sections.map((section) => section.title),
    ['RESOURCES', 'TRAFFIC', 'DATASTORE']
  );
  assert.equal(sections[0]?.cards[0]?.label, 'CPU');
  assert.equal(sections[1]?.cards[0]?.value, 12);
  assert.equal(sections[1]?.cards[1]?.label, 'Sim API p95');
  assert.equal(sections[2]?.cards[1]?.label, 'Queue');
});

test('buildMetricSections adds session RTT when edge latency is available', () => {
  const sections = buildMetricSections({
    metrics: sampleMetrics(),
    edgeRttMs: 48,
    edgeRttHistory: [40, 48],
  });

  assert.equal(sections[0]?.title, 'NETWORK');
  assert.equal(sections[0]?.cards[0]?.label, 'Session RTT');
  assert.equal(sections[0]?.cards[0]?.value, 48);
});

test('drawMetricsPanel clamps scroll and labels degraded service health', () => {
  const ctx = mockCtx();
  const scroll = {scrollY: 999, scrollMax: 0};
  const metrics = sampleMetrics();
  const left = {
    metrics,
    metricsHistory: [metrics, {...metrics, at: 2, cpu: 95}],
    metricsSource: 'live',
    edgeRttMs: 52,
    edgeRttHistory: [44, 52],
  };

  drawMetricsPanel(ctx, scroll, left, 180);

  assert.equal(scroll.scrollMax > 0, true);
  assert.equal(scroll.scrollY, scroll.scrollMax);
  assert.equal(
    ctx.state.calls.some((call) => call.text === 'SERVICE HEALTH'),
    true
  );
  assert.equal(
    ctx.state.calls.some((call) => call.text === 'RESOURCES'),
    true
  );
  assert.equal(
    ctx.state.calls.some((call) => call.text === 'Session RTT'),
    true
  );
  assert.equal(
    ctx.state.calls.some((call) => String(call.text).includes('%')),
    true
  );
});

test('drawMetricsPanel shows offline source label when metrics are stale', () => {
  const ctx = mockCtx();
  const scroll = {scrollY: 0, scrollMax: 0};
  const metrics = sampleMetrics();

  drawMetricsPanel(ctx, scroll, {
    metrics,
    metricsHistory: [metrics],
    metricsSource: 'offline',
    edgeRttMs: null,
    edgeRttHistory: [],
  });

  assert.equal(
    ctx.state.calls.some((call) => call.text === 'OFFLINE'),
    true
  );
});
