import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildAssistPrompt,
  computeSnapshotSize,
  describeAssistAvailability,
  formatDownloadProgress,
} = await tsImport('../../apps/web/src/pure/aiAssist.ts', import.meta.url);

test('computeSnapshotSize downscales wide canvases and keeps aspect ratio', () => {
  assert.deepEqual(computeSnapshotSize(1920, 1080, 1024), {
    width: 1024,
    height: 576,
  });
});

test('computeSnapshotSize keeps small canvases untouched', () => {
  assert.deepEqual(computeSnapshotSize(800, 450, 1024), {
    width: 800,
    height: 450,
  });
});

test('computeSnapshotSize guards degenerate dimensions', () => {
  assert.deepEqual(computeSnapshotSize(0, 0, 1024), {width: 1, height: 1});
  assert.deepEqual(computeSnapshotSize(-10, 5, 1024), {width: 1, height: 1});
  assert.deepEqual(computeSnapshotSize(200_000, 1, 1024), {
    width: 1024,
    height: 1,
  });
});

test('buildAssistPrompt trims input and rejects empty questions', () => {
  assert.equal(buildAssistPrompt('  障害箇所は?  '), '障害箇所は?');
  assert.equal(buildAssistPrompt('   '), undefined);
  assert.equal(buildAssistPrompt(''), undefined);
});

test('buildAssistPrompt clamps very long questions', () => {
  const long = 'あ'.repeat(3000);
  assert.equal(buildAssistPrompt(long)?.length, 2000);
});

test('describeAssistAvailability covers every state', () => {
  for (const state of [
    'unsupported',
    'unavailable',
    'downloadable',
    'downloading',
    'available',
  ]) {
    assert.equal(typeof describeAssistAvailability(state), 'string');
    assert.ok(describeAssistAvailability(state).length > 0);
  }
});

test('formatDownloadProgress renders clamped percentages', () => {
  assert.equal(formatDownloadProgress(0), '0%');
  assert.equal(formatDownloadProgress(0.42), '42%');
  assert.equal(formatDownloadProgress(1), '100%');
  assert.equal(formatDownloadProgress(4), '100%');
  assert.equal(formatDownloadProgress(Number.NaN), '0%');
});
