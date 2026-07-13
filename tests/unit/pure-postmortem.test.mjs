import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildPostmortemMarkdown,
  buildPostmortemSource,
  combinePostmortemAvailability,
  describePostmortemAvailability,
  POSTMORTEM_ACTIONS_TASK,
  POSTMORTEM_ROOT_CAUSE_TASK,
  POSTMORTEM_SHARED_CONTEXT,
  POSTMORTEM_SOURCE_MAX_LENGTH,
} = await tsImport('../../apps/web/src/pure/postmortem.ts', import.meta.url);

function baseInput(overrides = {}) {
  return {
    scenarioTitle: 'DB接続枯渇',
    result: 'resolved',
    durationMs: 192_000,
    events: [],
    incidentLog: [],
    ...overrides,
  };
}

test('buildPostmortemSource renders header with scenario, result and duration', () => {
  const source = buildPostmortemSource(baseInput());
  assert.match(source, /シナリオ: DB接続枯渇/);
  assert.match(source, /結果: resolved/);
  assert.match(source, /対応時間: 03:12/);
});

test('buildPostmortemSource shows 不明 when result is null', () => {
  const source = buildPostmortemSource(baseInput({result: null}));
  assert.match(source, /結果: 不明/);
});

test('buildPostmortemSource keeps important events in chronological order and drops noise', () => {
  const source = buildPostmortemSource(
    baseInput({
      events: [
        {type: 'incident_resolved', at_ms: 180_000, summary: '復旧を宣言'},
        {type: 'recording_chunk_created', at_ms: 10_000, summary: 'chunk'},
        {type: 'alert', at_ms: 12_000, summary: 'CPU使用率が90%を超過'},
        {type: 'session_start', at_ms: 0, summary: null},
        {type: 'participant_cursor', at_ms: 15_000, summary: 'cursor'},
        {
          type: 'command_detected',
          at_ms: 60_000,
          summary: 'systemctl restart api',
        },
      ],
    })
  );
  assert.match(source, /\[00:12\] alert: CPU使用率が90%を超過/);
  assert.match(source, /\[00:00\] session_start/);
  assert.doesNotMatch(source, /recording_chunk_created/);
  assert.doesNotMatch(source, /participant_cursor/);
  const order = [
    source.indexOf('session_start'),
    source.indexOf('alert'),
    source.indexOf('command_detected'),
    source.indexOf('incident_resolved'),
  ];
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'events should appear chronologically'
  );
  for (const index of order) assert.ok(index >= 0);
});

test('buildPostmortemSource keeps inject-related events', () => {
  const source = buildPostmortemSource(
    baseInput({
      events: [
        {type: 'inject_fired', at_ms: 30_000, summary: '上司からの電話'},
      ],
    })
  );
  assert.match(source, /\[00:30\] inject_fired: 上司からの電話/);
});

test('buildPostmortemSource renders incident log with Japanese kind labels', () => {
  const source = buildPostmortemSource(
    baseInput({
      incidentLog: [
        {kind: 'hypothesis', body: 'DB コネクション枯渇の可能性'},
        {kind: 'decision', body: 'APIを再起動する'},
        {kind: 'note', body: '  '},
      ],
    })
  );
  assert.match(source, /\(仮説\) DB コネクション枯渇の可能性/);
  assert.match(source, /\(判断\) APIを再起動する/);
  assert.equal(source.split('(メモ)').length, 1, 'blank entries are skipped');
});

test('buildPostmortemSource truncates to the cap keeping high-priority events', () => {
  const events = [];
  for (let i = 0; i < 500; i++) {
    events.push({
      type: 'command_detected',
      at_ms: i * 1000,
      summary: `コマンド実行 ${'x'.repeat(40)} #${i}`,
    });
  }
  events.push({type: 'alert', at_ms: 1000, summary: '重大アラート発生'});
  events.push({type: 'incident_resolved', at_ms: 500_000, summary: '復旧完了'});
  const source = buildPostmortemSource(baseInput({events}));
  assert.ok(source.length <= POSTMORTEM_SOURCE_MAX_LENGTH);
  assert.match(source, /重大アラート発生/);
  assert.match(source, /復旧完了/);
});

test('buildPostmortemMarkdown assembles sections and skips empty ones', () => {
  const full = buildPostmortemMarkdown({
    timeline: '- アラート発生',
    rootCause: 'コネクションプールの枯渇。',
    actions: '- 監視を追加する',
  });
  assert.match(full, /^## タイムライン要約\n\n- アラート発生/);
  assert.match(full, /## 根本原因\n\nコネクションプールの枯渇。/);
  assert.match(full, /## 改善アクション\n\n- 監視を追加する/);

  const partial = buildPostmortemMarkdown({
    timeline: '- アラート発生',
    actions: '  ',
  });
  assert.equal(partial, '## タイムライン要約\n\n- アラート発生');
  assert.equal(buildPostmortemMarkdown({}), '');
});

test('combinePostmortemAvailability follows the overall gate rule', () => {
  assert.equal(
    combinePostmortemAvailability('unsupported', 'unsupported'),
    'unsupported'
  );
  assert.equal(
    combinePostmortemAvailability('downloading', 'available'),
    'downloading'
  );
  assert.equal(
    combinePostmortemAvailability('available', 'downloading'),
    'downloading'
  );
  assert.equal(
    combinePostmortemAvailability('downloadable', 'available'),
    'downloadable'
  );
  assert.equal(
    combinePostmortemAvailability('available', 'downloadable'),
    'downloadable'
  );
  // Writer is optional: summarizer alone is enough.
  assert.equal(
    combinePostmortemAvailability('available', 'unsupported'),
    'available'
  );
  assert.equal(
    combinePostmortemAvailability('available', 'unavailable'),
    'available'
  );
  // Without a working summarizer the panel cannot produce its core output.
  assert.equal(
    combinePostmortemAvailability('unavailable', 'available'),
    'unavailable'
  );
  assert.equal(
    combinePostmortemAvailability('unsupported', 'available'),
    'unavailable'
  );
});

test('describePostmortemAvailability returns Japanese status text', () => {
  assert.equal(
    describePostmortemAvailability('unsupported'),
    'このブラウザはオンデバイスAIに対応していません'
  );
  assert.equal(
    describePostmortemAvailability('unavailable'),
    'この端末ではオンデバイスAIを利用できません'
  );
  assert.match(describePostmortemAvailability('downloadable'), /ダウンロード/);
  assert.match(
    describePostmortemAvailability('downloading'),
    /ダウンロードしています/
  );
  assert.match(describePostmortemAvailability('available'), /ポストモーテム/);
});

test('prompt constants are Japanese and mention their purpose', () => {
  assert.match(POSTMORTEM_SHARED_CONTEXT, /インシデント対応訓練/);
  assert.match(POSTMORTEM_SHARED_CONTEXT, /ポストモーテム/);
  assert.match(POSTMORTEM_ROOT_CAUSE_TASK, /根本原因/);
  assert.match(POSTMORTEM_ROOT_CAUSE_TASK, /2〜3文/);
  assert.match(POSTMORTEM_ACTIONS_TASK, /3〜5個/);
  assert.match(POSTMORTEM_ACTIONS_TASK, /箇条書き/);
});
