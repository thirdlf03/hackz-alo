import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  clamp,
  drawCoverImage,
  drawMagnifyIcon,
  extractTypedCommand,
  formatDifficulty,
  formatNarrativeClock,
  formatRecordingStatus,
  formatTime,
  metricTone,
  mirrorTerminalVisualLine,
  shortenPath,
  summarizeMetricsHealth,
  withAlpha,
  wrapCharacters,
  centeredText,
  drawSparkline,
  findTerminalCursorVisualLine,
  formatTerminalInputText,
  inputCaretX,
  normalizeMultilineText,
  roundRect,
  truncateToWidth,
  wrapText,
} = await tsImport(
  '../../apps/web/src/game/render/canvasDrawUtils.ts',
  import.meta.url
);

function mockCtx() {
  const state = {fillStyle: '', font: '', calls: []};
  return {
    state,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    rect() {},
    clip() {},
    fillRect() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    quadraticCurveTo() {},
    drawImage() {},
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
    set lineJoin(value) {},
    set lineCap(value) {},
  };
}

test('clamp and shortenPath normalize display values', () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(
    shortenPath('/workspace/services/batch/sales.kdm', 12),
    '...sales.kdm'
  );
});

test('format helpers render session clock and recording labels', () => {
  assert.equal(formatTime(65_000), '01:05');
  assert.equal(formatNarrativeClock(3.5), '深夜 03:30');
  assert.equal(formatDifficulty('beginner'), '初級');
  assert.equal(formatRecordingStatus('recording', true), 'REC');
  assert.equal(formatRecordingStatus('recording', false), 'LOG ONLY');
});

test('metricTone and summarizeMetricsHealth classify degraded metrics', () => {
  assert.equal(metricTone(10, 70, 85), 'healthy');
  assert.equal(metricTone(80, 70, 85), 'warn');
  assert.equal(metricTone(90, 70, 85), 'critical');

  const nominal = summarizeMetricsHealth({
    at: 1,
    cpu: 0,
    memory: 0,
    disk: 0,
    http5xxRate: 0,
    latencyP95Ms: 0,
    rps: 0,
    dbConnections: 0,
    queueDepth: 0,
  });
  assert.equal(nominal.label, 'DEGRADED');

  const critical = summarizeMetricsHealth({
    at: 1,
    cpu: 95,
    memory: 95,
    disk: 95,
    http5xxRate: 0.2,
    latencyP95Ms: 2000,
    rps: 1,
    dbConnections: 40,
    queueDepth: 30,
  });
  assert.equal(critical.label, 'CRITICAL');
  assert.equal(critical.level, 'critical');
});

test('withAlpha and wrapCharacters support sparkline rendering helpers', () => {
  assert.equal(withAlpha('#112233', 0.5), 'rgba(17, 34, 51, 0.5)');
  const ctx = {measureText: (text) => ({width: text.length * 8})};
  assert.deepEqual(wrapCharacters(ctx, 'abcdef', 100), ['abcdef']);
});

test('mirrorTerminalVisualLine and extractTypedCommand preserve terminal text', () => {
  const line = mirrorTerminalVisualLine([{text: 'ok'}], 'ok', 2);
  assert.equal(line.sourceIndex, 2);
  assert.equal(extractTypedCommand('prompt# typed'), 'typed');
});

test('drawing helpers render sparklines, rounded rects, and wrapped text', () => {
  const ctx = mockCtx();
  drawSparkline(ctx, 0, 0, 100, 40, [1, 4, 2], '#ff0000', 10);
  drawSparkline(ctx, 0, 0, 100, 40, [5], '#00ff00', 10);
  roundRect(ctx, 0, 0, 20, 20, 4);
  const nextY = wrapText(ctx, 'line one\nline two', 0, 0, 80, 16, 4);
  const listY = wrapText(ctx, '1. numbered item text', 0, nextY, 80, 16, 2);
  assert.equal(listY > nextY, true);
  centeredText(ctx, 'center', 0, 0, 100, 20);
  assert.equal(ctx.state.calls.length > 0, true);
});

test('terminal and recording helpers cover formatting branches', () => {
  const ctx = mockCtx();
  assert.equal(normalizeMultilineText('a\\nb'), 'a\nb');
  assert.equal(formatTerminalInputText('x'.repeat(120)).length, 96);
  assert.equal(formatRecordingStatus('idle', true), 'IDLE');
  assert.equal(formatRecordingStatus('consent_required', true), 'CONSENT');
  assert.equal(formatRecordingStatus('initializing', true), 'STARTING');
  assert.equal(formatRecordingStatus('stopping', true), 'SAVING');
  assert.equal(formatRecordingStatus('finalizing', true), 'SAVING');
  assert.equal(formatRecordingStatus('ready', true), 'SAVED');
  assert.equal(formatRecordingStatus('recording_error', true), 'REC ERROR');
  assert.equal(formatRecordingStatus('unsupported_browser', true), 'REC ERROR');
  assert.equal(formatRecordingStatus('finalization_failed', true), 'REC ERROR');
  assert.equal(formatRecordingStatus('upload_degraded', true), 'UPLOAD LAG');
  assert.equal(truncateToWidth(ctx, 'short', 100), 'short');
  assert.equal(truncateToWidth(ctx, 'very-long-label', 40).endsWith('…'), true);

  const line = mirrorTerminalVisualLine([{text: 'ok'}], 'ok', 1);
  const lines = [line, mirrorTerminalVisualLine([{text: 'b'}], 'b', 2)];
  assert.equal(findTerminalCursorVisualLine(lines, 1, 2), 0);
  assert.equal(findTerminalCursorVisualLine(lines, 2, 1), 1);
  assert.equal(findTerminalCursorVisualLine(lines, 9, 0), -1);
  assert.equal(inputCaretX(ctx, 'typed  ', 10) > 10, true);
  assert.match(withAlpha('#abc', 0.5), /rgba/);
  assert.equal(withAlpha('rgba(1,2,3,1)', 0.5), 'rgba(1,2,3,1)');
});

test('wrapCharacters and wrapText cover overflow and multiline branches', () => {
  const ctx = mockCtx();
  const wrapped = wrapCharacters(ctx, 'abcdefghijklmnop', 40);
  assert.equal(wrapped.length > 1, true);
  assert.deepEqual(wrapCharacters(ctx, '', 40), ['']);

  wrapText(ctx, '\n\nhello world', 0, 0, 80, 16, 10);
  wrapText(ctx, 'alpha beta gamma delta', 0, 0, 48, 16, 1);
  const listY = wrapText(
    ctx,
    '3. long numbered body that should wrap onto another line',
    0,
    0,
    72,
    16,
    6
  );
  assert.equal(listY > 0, true);
});

test('drawCoverImage and drawMagnifyIcon render image and icon affordances', () => {
  const ctx = mockCtx();
  drawCoverImage(ctx, {width: 200, height: 100}, 0, 0, 100, 100);
  drawCoverImage(ctx, {width: 100, height: 200}, 0, 0, 100, 100);
  drawMagnifyIcon(ctx, 12, 12, 24);
  drawSparkline(ctx, 0, 0, 0, 0, [1, 2], '#ff0000', 10);
});
