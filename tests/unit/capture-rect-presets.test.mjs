import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {captureRectPresets} = await tsImport(
  '../../apps/web/src/pure/captureRectPresets.ts',
  import.meta.url
);
const {logicalWidth, logicalHeight, monitorLayout} = await tsImport(
  '../../apps/web/src/pure/canvasLayout.ts',
  import.meta.url
);

test('captureRectPresets includes the full-screen preset with no rect (reset to whole canvas)', () => {
  const presets = captureRectPresets();
  const full = presets.find((preset) => preset.id === 'full');
  assert.ok(full);
  assert.equal(full.label, '全画面');
  assert.equal(full.rect, undefined);
});

test('captureRectPresets derives the metrics/terminal/runbook rects from canvasLayout monitor regions', () => {
  const presets = captureRectPresets();
  const byId = Object.fromEntries(presets.map((preset) => [preset.id, preset]));

  assert.deepEqual(byId.metrics.rect, toRect(monitorLayout('metrics')));
  assert.equal(byId.metrics.label, 'メトリクス');

  assert.deepEqual(byId.terminal.rect, toRect(monitorLayout('terminal')));
  assert.equal(byId.terminal.label, 'ターミナル');

  assert.deepEqual(byId.runbook.rect, toRect(monitorLayout('runbook')));
  assert.equal(byId.runbook.label, 'Runbook');
});

test('captureRectPresets rects stay within the canvas bounds with positive dimensions', () => {
  const presets = captureRectPresets();
  for (const preset of presets) {
    if (preset.rect === undefined) continue;
    const {x, y, width, height} = preset.rect;
    assert.ok(width > 0, `${preset.id} width should be positive`);
    assert.ok(height > 0, `${preset.id} height should be positive`);
    assert.ok(x >= 0, `${preset.id} x should be within canvas bounds`);
    assert.ok(y >= 0, `${preset.id} y should be within canvas bounds`);
    assert.ok(
      x + width <= logicalWidth,
      `${preset.id} should not overflow canvas width`
    );
    assert.ok(
      y + height <= logicalHeight,
      `${preset.id} should not overflow canvas height`
    );
  }
});

function toRect(monitor) {
  return {
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
  };
}
