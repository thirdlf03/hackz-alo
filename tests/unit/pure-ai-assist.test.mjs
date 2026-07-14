import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  ASSIST_SNAPSHOT_MAX_HEIGHT,
  ASSIST_SNAPSHOT_MAX_WIDTH,
  ASSIST_SYSTEM_PROMPT,
  buildAssistPrompt,
  clampDownloadRatio,
  computeSnapshotSize,
  describeAssistAvailability,
  describeModelDownloadStatus,
  formatDownloadProgress,
  normalizeCanvasCaptureRect,
  progressEventRatio,
} = await tsImport('../../apps/web/src/pure/aiAssist.ts', import.meta.url);

test('computeSnapshotSize downscales the native canvas to the attachment limit', () => {
  assert.equal(ASSIST_SNAPSHOT_MAX_WIDTH, 960);
  assert.equal(ASSIST_SNAPSHOT_MAX_HEIGHT, 540);
  assert.deepEqual(computeSnapshotSize(1920, 1080), {
    width: 960,
    height: 540,
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
    width: 960,
    height: 1,
  });
});

test('computeSnapshotSize safely downscales canvases above the maximum', () => {
  assert.deepEqual(computeSnapshotSize(3840, 2160), {
    width: 960,
    height: 540,
  });
  assert.deepEqual(computeSnapshotSize(1000, 2000), {
    width: 270,
    height: 540,
  });
});

test('normalizeCanvasCaptureRect maps CSS display coordinates to source pixels', () => {
  assert.deepEqual(
    normalizeCanvasCaptureRect(
      {startX: 100, startY: 50, endX: 500, endY: 300},
      {width: 960, height: 540},
      {width: 1920, height: 1080}
    ),
    {x: 200, y: 100, width: 800, height: 500}
  );
});

test('normalizeCanvasCaptureRect normalizes reverse drags and clamps overflow', () => {
  assert.deepEqual(
    normalizeCanvasCaptureRect(
      {startX: 900, startY: 500, endX: -20, endY: 100},
      {width: 800, height: 450},
      {width: 1600, height: 900}
    ),
    {x: 0, y: 200, width: 1600, height: 700}
  );
});

test('normalizeCanvasCaptureRect rounds outward to include partial source pixels', () => {
  assert.deepEqual(
    normalizeCanvasCaptureRect(
      {startX: 0.25, startY: 0.25, endX: 1.25, endY: 1.25},
      {width: 2, height: 2},
      {width: 3, height: 3}
    ),
    {x: 0, y: 0, width: 2, height: 2}
  );
});

test('normalizeCanvasCaptureRect returns an empty rectangle for unusable dimensions', () => {
  assert.deepEqual(
    normalizeCanvasCaptureRect(
      {startX: 0, startY: 0, endX: 10, endY: 10},
      {width: 0, height: 100},
      {width: 1920, height: 1080}
    ),
    {x: 0, y: 0, width: 0, height: 0}
  );
});

test('system prompt grounds answers in the attached in-game canvas', () => {
  assert.match(ASSIST_SYSTEM_PROMPT, /縮小画像または選択範囲/);
  assert.match(ASSIST_SYSTEM_PROMPT, /最新の添付画像/);
  assert.match(ASSIST_SYSTEM_PROMPT, /タスク一覧/);
  assert.match(ASSIST_SYSTEM_PROMPT, /Incident Log/);
  assert.match(ASSIST_SYSTEM_PROMPT, /推測/);
  assert.match(ASSIST_SYSTEM_PROMPT, /180文字以内/);
  assert.match(ASSIST_SYSTEM_PROMPT, /根拠.*最大2点/);
  assert.match(ASSIST_SYSTEM_PROMPT, /次の一手:.*根拠:/);
  assert.match(ASSIST_SYSTEM_PROMPT, /必要なコマンドは省略しない/);
  assert.match(ASSIST_SYSTEM_PROMPT, /固有名詞、コマンドを作らず/);
  assert.match(ASSIST_SYSTEM_PROMPT, /コマンド.*そのまま/);
  assert.match(ASSIST_SYSTEM_PROMPT, /確認工程.*省略せず/);
});

test('system prompt forbids reciting runbook caution notes as the next step', () => {
  assert.match(
    ASSIST_SYSTEM_PROMPT,
    /画像に写っている文字列をそのままコピーして/
  );
  assert.match(
    ASSIST_SYSTEM_PROMPT,
    /画像にないコマンド名を作らないでください/
  );
  assert.match(
    ASSIST_SYSTEM_PROMPT,
    /Runbookの注意書きや方針・精神論.*を次の一手にしない/
  );
  assert.doesNotMatch(ASSIST_SYSTEM_PROMPT, /1つの手順に限定/);
});

test('system prompt prefers chat/other on-screen hints over the runbook when its command is already executed and unresolved', () => {
  assert.match(
    ASSIST_SYSTEM_PROMPT,
    /ターミナルで実行済みなのに問題が続いている場合は、Runbookではなくチャットの助言や他の画面内の手がかりにあるコマンドを次の一手にして/
  );
});

test('system prompt prefers on-screen evidence over the runbook when they conflict', () => {
  assert.match(ASSIST_SYSTEM_PROMPT, /Runbookと矛盾する場合/);
  assert.match(ASSIST_SYSTEM_PROMPT, /Runbookの記述より画面上の他の証拠を優先/);
});

test('system prompt asks for "不足:" instead of a fabricated command when ungrounded', () => {
  assert.match(
    ASSIST_SYSTEM_PROMPT,
    /画像と質問文から答えの根拠が見つからない場合は、コマンドを作らずに次の一手へ「不足:」に続けて知りたい情報を書いてください。/
  );
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
