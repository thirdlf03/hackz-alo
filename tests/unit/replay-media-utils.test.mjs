import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildTimelineFromEvents,
  filterImportantEvents,
  formatDuration,
  formatSeconds,
  gameTimeToVideoSeekSeconds,
  inferRecordingStartedAtGameMs,
  isTimelineEventType,
  parseBrowserInfo,
  parseRecordingClockSegments,
  parseRecordingStartedAtGameMs,
  timelineEventDisplaySeconds,
} = await tsImport(
  '../../apps/web/src/replay/replayMediaUtils.ts',
  import.meta.url
);

test('isTimelineEventType excludes noisy recording and duplicate command events', () => {
  assert.equal(isTimelineEventType('command_detected'), true);
  assert.equal(isTimelineEventType('session_start'), true);
  assert.equal(isTimelineEventType('terminal_input'), false);
  assert.equal(isTimelineEventType('ui_click'), false);
  assert.equal(isTimelineEventType('recording_chunk_created'), false);
});

test('buildTimelineFromEvents prefers API events and filters timeline types', () => {
  const timeline = buildTimelineFromEvents([
    {event_id: 'e1', type: 'session_start', at_ms: 0, summary: 'session_start'},
    {
      event_id: 'e2',
      type: 'terminal_input',
      at_ms: 1000,
      summary: 'command: ls',
    },
    {
      event_id: 'e3',
      type: 'command_detected',
      at_ms: 1000,
      summary: 'command: ls',
    },
    {event_id: 'e4', type: 'ui_click', at_ms: 2000, summary: 'ui_click'},
    {
      event_id: 'e5',
      type: 'recording_chunk_created',
      at_ms: 5000,
      summary: 'recording_chunk_created',
    },
  ]);

  assert.deepEqual(
    timeline.map((entry) => entry.label),
    ['シナリオ開始', 'command: ls']
  );
});

test('buildTimelineFromEvents hides generic commands paired with semantic events', () => {
  const timeline = buildTimelineFromEvents([
    {
      event_id: 'command-restart',
      type: 'command_detected',
      at_ms: 63_000,
      summary: 'command: yamactl restart api',
    },
    {
      event_id: 'restart',
      type: 'service_restart',
      at_ms: 63_000,
      summary: '再起動: yamactl restart api',
    },
    {
      event_id: 'command-ls',
      type: 'command_detected',
      at_ms: 70_000,
      summary: 'command: ls -la',
    },
  ]);

  assert.deepEqual(
    timeline.map((entry) => entry.id),
    ['restart', 'command-ls']
  );
});

test('buildTimelineFromEvents deduplicates every paired command semantic type', () => {
  const pairs = [
    {
      type: 'file_opened',
      command: 'tail -n 50 /tmp/app.log',
      semantic: 'ファイル: /tmp/app.log',
    },
    {
      type: 'service_restart',
      command: 'yamactl restart api',
      semantic: '再起動: yamactl restart api',
    },
    {
      type: 'recovery_check',
      command: 'yamactl status api',
      semantic: '復旧確認: yamactl status api',
    },
  ];
  const events = pairs.flatMap((pair, index) => {
    const at_ms = (index + 1) * 1000;
    return [
      {
        event_id: `command-${String(index)}`,
        type: 'command_detected',
        at_ms,
        summary: `command: ${pair.command}`,
      },
      {
        event_id: `semantic-${String(index)}`,
        type: pair.type,
        at_ms,
        summary: pair.semantic,
      },
    ];
  });

  assert.deepEqual(
    buildTimelineFromEvents(events).map((entry) => entry.id),
    ['semantic-0', 'semantic-1', 'semantic-2']
  );
});

test('buildTimelineFromEvents preserves unrelated commands at the same time', () => {
  const timeline = buildTimelineFromEvents([
    {
      event_id: 'command-ls',
      type: 'command_detected',
      at_ms: 63_000,
      summary: 'command: ls -la',
    },
    {
      event_id: 'restart',
      type: 'service_restart',
      at_ms: 63_000,
      summary: '再起動: yamactl restart api',
    },
  ]);

  assert.deepEqual(
    timeline.map((entry) => entry.id),
    ['command-ls', 'restart']
  );
});

test('gameTimeToVideoSeekSeconds scales game clock to video duration', () => {
  assert.equal(gameTimeToVideoSeekSeconds(21, 15, 21_000, 6_000), 15);
  assert.equal(gameTimeToVideoSeekSeconds(11, 15, 21_000, 6_000), 5);
  assert.equal(gameTimeToVideoSeekSeconds(6, 15, 21_000, 6_000), 0);
});

test('gameTimeToVideoSeekSeconds follows recorded speed-change segments', () => {
  const segments = [
    {gameMs: 0, videoMs: 0, speed: 8},
    {gameMs: 16_000, videoMs: 2_000, speed: 2},
  ];

  assert.equal(gameTimeToVideoSeekSeconds(8, 6, 24_000, 0, segments), 1);
  assert.equal(gameTimeToVideoSeekSeconds(16, 6, 24_000, 0, segments), 2);
  assert.equal(gameTimeToVideoSeekSeconds(20, 6, 24_000, 0, segments), 4);
  assert.equal(gameTimeToVideoSeekSeconds(24, 6, 24_000, 0, segments), 6);
  assert.equal(gameTimeToVideoSeekSeconds(28, 6, 24_000, 0, segments), 6);
});

test('parseRecordingClockSegments ignores malformed metadata', () => {
  assert.equal(parseRecordingClockSegments(undefined), undefined);
  assert.equal(
    parseRecordingClockSegments({recordingClockSegments: []}),
    undefined
  );
  assert.equal(
    parseRecordingClockSegments({
      recordingClockSegments: [{gameMs: 0, videoMs: 0, speed: 0}],
    }),
    undefined
  );
  assert.deepEqual(
    parseRecordingClockSegments({
      recordingClockSegments: [
        {gameMs: 16_000, videoMs: 2_000, speed: 2},
        {gameMs: 0, videoMs: 0, speed: 8},
        {gameMs: -1, videoMs: 0, speed: 8},
      ],
    }),
    [
      {gameMs: 0, videoMs: 0, speed: 8},
      {gameMs: 16_000, videoMs: 2_000, speed: 2},
    ]
  );
});

test('timelineEventDisplaySeconds keeps logical event time past video end', () => {
  assert.equal(timelineEventDisplaySeconds(63), 63);
  assert.equal(timelineEventDisplaySeconds(70), 70);
  assert.equal(timelineEventDisplaySeconds(90), 90);
});

test('inferRecordingStartedAtGameMs estimates late recorder start', () => {
  assert.equal(inferRecordingStartedAtGameMs(21_000, 15), 6_000);
  assert.equal(inferRecordingStartedAtGameMs(15_000, 15), 0);
  assert.equal(inferRecordingStartedAtGameMs(0, 15), 0);
  assert.equal(inferRecordingStartedAtGameMs(21_000, 0), 0);
});

test('parseBrowserInfo and parseRecordingStartedAtGameMs read browser metadata', () => {
  assert.equal(parseBrowserInfo(null), undefined);
  assert.equal(parseBrowserInfo('not-json'), undefined);
  assert.deepEqual(parseBrowserInfo('{"ua":"x"}'), {ua: 'x'});
  assert.equal(
    parseRecordingStartedAtGameMs(
      {recordingStartedAtGameMs: 4_000},
      20_000,
      10
    ),
    4_000
  );
  assert.equal(parseRecordingStartedAtGameMs({}, 21_000, 15), 6_000);
});

test('filterImportantEvents keeps incident-critical replay events', () => {
  const events = [
    {event_id: 'e1', type: 'alert', at_ms: 1},
    {event_id: 'e2', type: 'terminal_input', at_ms: 2},
    {event_id: 'e3', type: 'incident_resolved', at_ms: 3},
    {event_id: 'e4', type: 'player_note', at_ms: 4},
  ];
  assert.deepEqual(
    filterImportantEvents(events).map((event) => event.type),
    ['alert', 'incident_resolved', 'player_note']
  );
});

test('formatSeconds and formatDuration render stable labels', () => {
  assert.equal(formatSeconds(65), '01:05');
  assert.equal(formatDuration(65_000), '01:05');
  assert.equal(formatDuration(-1_000), '00:00');
});

test('buildTimelineFromEvents falls back to scenario timeline entries', () => {
  const timeline = buildTimelineFromEvents(
    [],
    [
      {at: 2, label: 'fallback event'},
      {at: 0, label: ''},
    ]
  );
  assert.deepEqual(timeline, [
    {id: 'fallback-0-2-fallback event', at: 2, label: 'fallback event'},
  ]);
});

test('buildTimelineFromEvents uses default labels for known event types', () => {
  const timeline = buildTimelineFromEvents([
    {event_id: 'e1', type: 'session_end', at_ms: 2_000},
    {event_id: 'e2', type: 'incident_resolved', at_ms: 3_000},
    {event_id: 'e3', type: 'monitor_update', at_ms: 4_000},
  ]);
  assert.deepEqual(
    timeline.map((entry) => entry.label),
    ['セッション終了', '復旧宣言', 'メトリクス更新']
  );
});
