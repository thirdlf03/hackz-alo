import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  ASSIST_SNAPSHOT_MAX_WIDTH,
  ASSIST_SYSTEM_PROMPT,
  buildAssistPrompt,
  clampDownloadRatio,
  computeSnapshotSize,
  describeAssistAvailability,
  describeModelDownloadStatus,
  formatDownloadProgress,
  progressEventRatio,
} = await tsImport('../../apps/web/src/pure/aiAssist.ts', import.meta.url);

test('computeSnapshotSize preserves the native in-game canvas resolution', () => {
  assert.equal(ASSIST_SNAPSHOT_MAX_WIDTH, 1920);
  assert.deepEqual(computeSnapshotSize(1920, 1080), {
    width: 1920,
    height: 1080,
  });
});

test('computeSnapshotSize keeps small canvases untouched', () => {
  assert.deepEqual(computeSnapshotSize(800, 450), {
    width: 800,
    height: 450,
  });
});

test('computeSnapshotSize guards degenerate dimensions', () => {
  assert.deepEqual(computeSnapshotSize(0, 0), {width: 1, height: 1});
  assert.deepEqual(computeSnapshotSize(-10, 5), {width: 1, height: 1});
  assert.deepEqual(computeSnapshotSize(200_000, 1), {
    width: 1920,
    height: 1,
  });
});

test('computeSnapshotSize safely downscales canvases above the maximum', () => {
  assert.deepEqual(computeSnapshotSize(3840, 2160), {
    width: 1920,
    height: 1080,
  });
});

test('system prompt grounds answers in the attached in-game canvas', () => {
  assert.match(ASSIST_SYSTEM_PROMPT, /1920x1080/);
  assert.match(ASSIST_SYSTEM_PROMPT, /最新の添付画像/);
  assert.match(ASSIST_SYSTEM_PROMPT, /タスク一覧/);
  assert.match(ASSIST_SYSTEM_PROMPT, /Incident Log/);
  assert.match(ASSIST_SYSTEM_PROMPT, /推測/);
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

test('describeModelDownloadStatus reports the downloaded state', () => {
  assert.equal(
    describeModelDownloadStatus('available'),
    'AIモデルはダウンロード済みです'
  );
});

test('describeModelDownloadStatus reports the downloadable state', () => {
  assert.equal(describeModelDownloadStatus('downloadable').length > 0, true);
});

test('describeModelDownloadStatus reports downloading without progress', () => {
  assert.equal(
    describeModelDownloadStatus('downloading'),
    'AIモデルをダウンロードしています…'
  );
});

test('describeModelDownloadStatus omits fake 0% at download start', () => {
  assert.equal(
    describeModelDownloadStatus('downloading', 0),
    'AIモデルをダウンロードしています…'
  );
});

test('describeModelDownloadStatus reports downloading with progress', () => {
  assert.equal(
    describeModelDownloadStatus('downloading', 0.5),
    'AIモデルをダウンロードしています… 50%'
  );
});

test('describeModelDownloadStatus reports preparing after download completes', () => {
  assert.equal(
    describeModelDownloadStatus('downloading', 1),
    'AIモデルを準備しています…'
  );
});

test('describeModelDownloadStatus returns empty string for unsupported states', () => {
  assert.equal(describeModelDownloadStatus('unsupported'), '');
  assert.equal(describeModelDownloadStatus('unavailable'), '');
});

test('clampDownloadRatio clamps values into 0-1', () => {
  assert.equal(clampDownloadRatio(0.5), 0.5);
  assert.equal(clampDownloadRatio(-1), 0);
  assert.equal(clampDownloadRatio(1.5), 1);
  assert.equal(clampDownloadRatio(Number.NaN), 0);
  assert.equal(clampDownloadRatio(Number.POSITIVE_INFINITY), 0);
});

test('progressEventRatio treats loaded as 0-1 fraction when total is 1 or missing', () => {
  assert.equal(progressEventRatio({loaded: 0.42}), 0.42);
  assert.equal(progressEventRatio({loaded: 0.42, total: 1}), 0.42);
  assert.equal(progressEventRatio({loaded: 1, total: 1}), 1);
  assert.equal(progressEventRatio({loaded: 0}), 0);
});

test('progressEventRatio uses loaded/total when total > 1 (byte-style)', () => {
  assert.equal(progressEventRatio({loaded: 50, total: 100}), 0.5);
  assert.equal(progressEventRatio({loaded: 100, total: 100}), 1);
  assert.equal(progressEventRatio({loaded: 0, total: 100}), 0);
});

test('progressEventRatio returns undefined for missing or non-finite loaded', () => {
  assert.equal(progressEventRatio({}), undefined);
  assert.equal(progressEventRatio({loaded: Number.NaN}), undefined);
  assert.equal(
    progressEventRatio({loaded: Number.POSITIVE_INFINITY}),
    undefined
  );
});
