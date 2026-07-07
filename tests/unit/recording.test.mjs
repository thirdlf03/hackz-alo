import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  defaultRecordingMimeTypes,
  pickSupportedMimeType,
  recordingChunkMs,
  recordingMultipartPartSize,
  splitBufferIntoParts,
} from '../../packages/shared/src/recording.ts';
import {
  replayEventSummary,
  createReplayEvent,
  toJsonLine,
} from '../../packages/shared/src/events.ts';

test('recording defaults keep chunk cadence and multipart part size separate', () => {
  assert.equal(recordingChunkMs, 5000);
  assert.equal(recordingMultipartPartSize, 8 * 1024 * 1024);
});

test('recording MIME selection prefers the first supported candidate', () => {
  const calls = [];
  const selected = pickSupportedMimeType((candidate) => {
    calls.push(candidate);
    return candidate === 'video/webm';
  });

  assert.equal(selected, 'video/webm');
  assert.deepEqual(calls, [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]);
});

test('recording MIME selection falls back past unsupported and throwing candidates', () => {
  const selected = pickSupportedMimeType(
    (candidate) => {
      if (candidate.includes('vp9')) throw new Error('browser probe failed');
      return candidate === 'video/webm';
    },
    ['video/webm;codecs=vp9,opus', '', 'video/webm']
  );

  assert.equal(selected, 'video/webm');
});

test('recording MIME selection returns undefined when no candidate is supported', () => {
  assert.equal(
    pickSupportedMimeType(() => false, defaultRecordingMimeTypes),
    undefined
  );
});

test('splitBufferIntoParts creates fixed-size parts with a smaller tail', () => {
  const buffer = new Uint8Array(8 * 1024 * 1024 + 123);
  const parts = splitBufferIntoParts(buffer, 8 * 1024 * 1024);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.length, 8 * 1024 * 1024);
  assert.equal(parts[1]?.length, 123);
});

test('replayEventSummary formats player chat reports', () => {
  const summary = replayEventSummary(
    createReplayEvent({
      replayId: 'repl_test',
      type: 'player_note',
      at: 1000,
      actor: 'player',
      payload: {body: 'API が落ちています', channel: 'chat'},
    })
  );
  assert.equal(summary, 'チャット報告: API が落ちています');
});

test('replayEventSummary formats session lifecycle labels', () => {
  assert.equal(
    replayEventSummary(
      createReplayEvent({
        replayId: 'repl_test',
        type: 'session_start',
        at: 0,
        actor: 'system',
        payload: {scenarioId: 'process-stop-001'},
      })
    ),
    'シナリオ開始'
  );
  assert.equal(
    replayEventSummary(
      createReplayEvent({
        replayId: 'repl_test',
        type: 'session_end',
        at: 1000,
        actor: 'player',
        payload: {result: 'retired'},
      })
    ),
    '解雇！'
  );
});

test('replayEventSummary covers event label branches', () => {
  const replayId = 'repl_test';
  const cases = [
    {
      type: 'session_end',
      payload: {result: 'false_resolve'},
      expected: '未復旧のまま解雇',
    },
    {
      type: 'session_end',
      payload: {result: 'failed'},
      expected: '解雇！',
    },
    {
      type: 'session_end',
      payload: {result: 'timeout'},
      expected: '解雇！',
    },
    {
      type: 'session_end',
      payload: {result: 'aborted'},
      expected: '強制終了',
    },
    {
      type: 'session_end',
      payload: {result: 'resolved'},
      expected: 'セッション終了',
    },
    {
      type: 'terminal_input',
      payload: {data: '  ls -la '},
      expected: 'command: ls -la',
    },
    {
      type: 'alert',
      payload: {message: 'latency high'},
      expected: 'alert: latency high',
    },
    {
      type: 'runbook_open',
      payload: {runbookId: 'rb-1'},
      expected: 'runbook: rb-1',
    },
    {
      type: 'command_detected',
      payload: {command: 'restart api'},
      expected: 'command: restart api',
    },
    {
      type: 'recovery_check',
      payload: {command: 'curl health'},
      expected: '復旧確認: curl health',
    },
    {
      type: 'service_restart',
      payload: {command: 'yamactl restart api'},
      expected: '再起動: yamactl restart api',
    },
    {
      type: 'file_opened',
      payload: {path: '/workspace/app.kdm'},
      expected: 'ファイル: /workspace/app.kdm',
    },
    {
      type: 'file_saved',
      payload: {path: '/workspace/app.kdm'},
      expected: '保存: /workspace/app.kdm',
    },
    {
      type: 'ui_panel_open',
      payload: {panel: 'editor'},
      expected: 'Editor を開いた',
    },
    {
      type: 'ui_panel_open',
      payload: {panel: 'notifications'},
      expected: '通知パネルを開いた',
    },
    {
      type: 'ui_panel_open',
      payload: {panel: 'chat_compose'},
      expected: 'チャット返信を開始',
    },
    {
      type: 'ui_panel_open',
      payload: {panel: 'metrics'},
      expected: 'パネル: metrics',
    },
    {
      type: 'monitor_update',
      payload: {label: 'CPU'},
      expected: 'メトリクス: CPU',
    },
    {
      type: 'incident_resolved',
      payload: {},
      expected: '復旧宣言',
    },
    {
      type: 'scenario_event',
      payload: {},
      expected: 'scenario_event',
    },
  ];

  for (const {type, payload, expected} of cases) {
    assert.equal(
      replayEventSummary(
        createReplayEvent({
          replayId,
          type,
          at: 1,
          actor: 'player',
          payload,
        })
      ),
      expected,
      type
    );
  }
});

test('createReplayEvent and toJsonLine serialize replay events', () => {
  const event = createReplayEvent({
    replayId: 'repl_test',
    type: 'session_start',
    at: 12,
    actor: 'system',
    payload: {scenarioId: 'demo'},
    visibility: 'private',
  });
  assert.equal(event.at, 12);
  assert.equal(event.visibility, 'private');
  assert.match(event.id, /^evt_/);
  assert.match(toJsonLine(event), /"replayId":"repl_test"/);
});
