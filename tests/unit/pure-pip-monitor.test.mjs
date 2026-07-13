import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {PIP_MONITOR_LABELS, pipRegionForMonitor, pipWindowSize} = await tsImport(
  '../../apps/web/src/pure/pipMonitor.ts',
  import.meta.url
);
const {monitorLayouts} = await tsImport(
  '../../apps/web/src/pure/canvasLayout.ts',
  import.meta.url
);

test('pipRegionForMonitor maps to the monitor layout rects', () => {
  const metrics = monitorLayouts.find((monitor) => monitor.id === 'metrics');
  assert.deepEqual(pipRegionForMonitor('metrics'), {
    x: metrics.x,
    y: metrics.y,
    width: metrics.width,
    height: metrics.height,
  });
  const runbook = monitorLayouts.find((monitor) => monitor.id === 'runbook');
  assert.deepEqual(pipRegionForMonitor('chat'), {
    x: runbook.x,
    y: runbook.y,
    width: runbook.width,
    height: runbook.height,
  });
});

test('pipWindowSize preserves aspect ratio under the max width', () => {
  const size = pipWindowSize({x: 0, y: 0, width: 540, height: 620}, 420);
  assert.equal(size.width, 420);
  assert.equal(size.height, Math.round((620 / 540) * 420));
  const small = pipWindowSize({x: 0, y: 0, width: 300, height: 150}, 420);
  assert.deepEqual(small, {width: 300, height: 150});
});

test('pipWindowSize survives degenerate regions', () => {
  const size = pipWindowSize({x: 0, y: 0, width: 0, height: 0});
  assert.ok(size.width > 0 && size.height > 0);
});

test('labels exist for every pip monitor', () => {
  assert.equal(typeof PIP_MONITOR_LABELS.metrics, 'string');
  assert.equal(typeof PIP_MONITOR_LABELS.chat, 'string');
});
