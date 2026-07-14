import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  STATE_TEXT_SYSTEM_PROMPT,
  buildPanelStateAskText,
  buildStateAskText,
} from '../../scripts/lib/ai-assist-state-text.mjs';

test('STATE_TEXT_SYSTEM_PROMPT addresses the textualized screen instead of an image', () => {
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /画面テキストあり:/);
  assert.doesNotMatch(STATE_TEXT_SYSTEM_PROMPT, /画像あり:/);
  assert.doesNotMatch(STATE_TEXT_SYSTEM_PROMPT, /画像なし:/);
});

test('STATE_TEXT_SYSTEM_PROMPT keeps the full NEXT confirmation-step copy rule', () => {
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /画面テキストにNEXTまたは復旧手順があれば/);
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /確認工程を含むコマンド列を省略せずそのまま次の一手にして/);
});

test('STATE_TEXT_SYSTEM_PROMPT prefers chat/other on-screen hints over an already-executed runbook command', () => {
  assert.match(
    STATE_TEXT_SYSTEM_PROMPT,
    /ターミナルで実行済みなのに問題が続いている場合は、Runbookではなくチャットの助言や他の画面テキスト内の手がかりにあるコマンドを次の一手にして/
  );
});

test('STATE_TEXT_SYSTEM_PROMPT forbids fabricating commands and reciting runbook caution notes', () => {
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /画面テキストに書かれている文字列をそのままコピーして/);
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /画面テキストにないコマンド名を作らないでください/);
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /Runbookの注意書きや方針・精神論.*を次の一手にしない/);
});

test('STATE_TEXT_SYSTEM_PROMPT keeps the answer format rules unchanged', () => {
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /180文字以内/);
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /次の一手:.*根拠:/);
  assert.match(STATE_TEXT_SYSTEM_PROMPT, /根拠.*最大2点/);
});

test('buildStateAskText embeds the title and lines under a 画面テキスト block and keeps the discipline rules', () => {
  const text = buildStateAskText(['SERVICE HEALTH   DEGRADED'], 'INCIDENT TRAINING', '次の一手は?');
  assert.match(text, /画面テキスト:/);
  assert.match(text, /INCIDENT TRAINING/);
  assert.match(text, /SERVICE HEALTH   DEGRADED/);
  assert.match(text, /質問: 次の一手は\?/);
  assert.match(text, /180文字以内/);
});

test('buildPanelStateAskText groups db-pool-culprit lines into labeled panels in a fixed order', () => {
  const lines = [
    'SERVICE HEALTH   DEGRADED',
    'DB CONN          40/40',
    'ALERT: DB connection pool exhausted',
    'ALERT: HTTP 5xx rate is above threshold',
    'TERMINAL: $ cat /workspace/run/fake-db-stats.json',
    'RUNBOOK: DB を再起動しても、犯人が生きていればすぐ再発する',
    'CHAT: 先輩(仮眠中): ん…月次レポートのバッチ、今夜だったかも…zzz',
  ];
  const text = buildPanelStateAskText(lines, 'INCIDENT TRAINING / やまびこ API', '状況の判断と次の一手を教えてください。');
  const expected = [
    'INCIDENT TRAINING / やまびこ API',
    '以下はゲーム画面の内容をテキスト化したものです。これだけを根拠にし、画面テキストにない事実やコマンドを作らないでください。',
    '画面テキストにNEXTがあれば、そのコマンド列を確認工程まで次の一手へ完全にコピーしてください(途中で切らないでください)。ただしそのコマンドが実行済みで解決していない場合は、チャットの助言など他の画面テキスト内のコマンドを次の一手にしてください。',
    '次の一手のコマンドは画面テキスト内の文字列をそのままコピーし、画面テキストにないコマンドを作らず、Runbookの注意書きや方針の復唱はしないでください。必ず180文字以内で答えてください。',
    '## メトリクス(監視ダッシュボード)',
    'SERVICE HEALTH   DEGRADED',
    'DB CONN          40/40',
    '## アラート(通知パネル)',
    'DB connection pool exhausted',
    'HTTP 5xx rate is above threshold',
    '## ターミナル(実行済みコマンド)',
    '$ cat /workspace/run/fake-db-stats.json',
    '## Runbook(表示中の手順書)',
    'DB を再起動しても、犯人が生きていればすぐ再発する',
    '## チャット(同僚の発言)',
    '先輩(仮眠中): ん…月次レポートのバッチ、今夜だったかも…zzz',
    '質問: 状況の判断と次の一手を教えてください。',
  ].join('\n');
  assert.equal(text, expected);
});

test('buildPanelStateAskText fixes section order (アラート->ターミナル->Runbook->チャット) regardless of input line order', () => {
  const lines = [
    'CHAT: 先輩: 見てみ',
    'RUNBOOK: 手順書の内容',
    'TERMINAL: $ ls',
    'ALERT: 何かが起きた',
  ];
  const text = buildPanelStateAskText(lines, 'TITLE', 'Q');
  const alertIndex = text.indexOf('## アラート');
  const terminalIndex = text.indexOf('## ターミナル');
  const runbookIndex = text.indexOf('## Runbook');
  const chatIndex = text.indexOf('## チャット');
  assert.ok(alertIndex < terminalIndex);
  assert.ok(terminalIndex < runbookIndex);
  assert.ok(runbookIndex < chatIndex);
  assert.equal(text.includes('## メトリクス'), false);
});

test('buildPanelStateAskText omits empty sections', () => {
  const text = buildPanelStateAskText(['SERVICE HEALTH   OK'], 'TITLE', 'Q');
  assert.match(text, /## メトリクス\(監視ダッシュボード\)/);
  assert.equal(text.includes('## アラート'), false);
  assert.equal(text.includes('## ターミナル'), false);
  assert.equal(text.includes('## Runbook'), false);
  assert.equal(text.includes('## チャット'), false);
});

test('buildPanelStateAskText strips label prefixes but keeps the $ command prefix inside TERMINAL lines', () => {
  const text = buildPanelStateAskText(
    ['TERMINAL: $ yamactl restart api', 'ALERT: health check failed'],
    'TITLE',
    'Q'
  );
  assert.match(text, /\$ yamactl restart api/);
  assert.equal(text.includes('TERMINAL:'), false);
  assert.match(text, /(?<!ALERT: )health check failed/);
  assert.equal(text.includes('ALERT: health check failed'), false);
});

test('buildPanelStateAskText shares the discipline lines and 質問 format with buildStateAskText', () => {
  const lines = ['ALERT: 何かが起きた'];
  const flat = buildStateAskText(lines, 'TITLE', '次の一手は?');
  const panels = buildPanelStateAskText(lines, 'TITLE', '次の一手は?');
  for (const disciplineLine of [
    '画面テキストにNEXTがあれば',
    '次の一手のコマンドは画面テキスト内の文字列をそのままコピーし',
  ]) {
    assert.match(flat, new RegExp(disciplineLine));
    assert.match(panels, new RegExp(disciplineLine));
  }
  assert.match(panels, /質問: 次の一手は\?$/);
});
