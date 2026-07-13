import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildPagerNotificationPayload,
  buildPagerAlertPayload,
  buildPagerChatPayload,
  pagerNotificationTag,
  shouldThrottlePagerAlert,
  PAGER_ALERT_MIN_INTERVAL_MS,
} = await tsImport(
  '../../apps/worker/src/pure/pagerNotification.ts',
  import.meta.url
);

test('buildPagerNotificationPayload includes P1 marker and scenario title', () => {
  const payload = buildPagerNotificationPayload(
    {title: 'こだまバッチ障害', briefing: ['こだまが返ってきません。']},
    'https://example.com/',
    'sess_1'
  );
  assert.match(payload.title, /【P1】/);
  assert.match(payload.title, /こだまバッチ障害/);
});

test('buildPagerNotificationPayload includes briefing first line in body', () => {
  const payload = buildPagerNotificationPayload(
    {title: 'ディスク枯渇', briefing: ['ディスクが満杯です。', '二行目']},
    'https://example.com/',
    'sess_1'
  );
  assert.match(payload.body, /ディスクが満杯です。/);
});

test('buildPagerNotificationPayload sets data.url to the given session URL', () => {
  const sessionUrl = 'https://example.com/sess_abc/';
  const payload = buildPagerNotificationPayload(
    {title: 'ネットワーク断', briefing: ['LAN ケーブルが抜けています。']},
    sessionUrl,
    'sess_abc'
  );
  assert.equal(payload.data.url, sessionUrl);
});

test('buildPagerNotificationPayload does not throw when briefing is empty', () => {
  const payload = buildPagerNotificationPayload(
    {title: 'キーボード浸水', briefing: []},
    'https://example.com/',
    'sess_1'
  );
  assert.match(payload.title, /【P1】キーボード浸水/);
  assert.equal(typeof payload.body, 'string');
  assert.ok(payload.body.length > 0);
});

test('buildPagerNotificationPayload sets a session-scoped tag', () => {
  const payload = buildPagerNotificationPayload(
    {title: 'ディスク枯渇', briefing: []},
    'https://example.com/',
    'sess_abc'
  );
  assert.equal(payload.tag, pagerNotificationTag('sess_abc'));
  assert.equal(payload.tag, 'pager-sess_abc');
});

test('buildPagerAlertPayload marks critical severity with P1', () => {
  const payload = buildPagerAlertPayload(
    {title: 'アラート大量発生', briefing: []},
    {message: 'CPU使用率が95%を超えました', severity: 'critical'},
    'https://example.com/',
    'sess_1'
  );
  assert.match(payload.title, /【P1】/);
  assert.match(payload.title, /アラート大量発生/);
  assert.equal(payload.body, 'CPU使用率が95%を超えました');
  assert.equal(payload.tag, 'pager-sess_1');
  assert.equal(payload.data.url, 'https://example.com/');
});

test('buildPagerAlertPayload reflects non-critical severities', () => {
  const warning = buildPagerAlertPayload(
    {title: 'テスト', briefing: []},
    {message: '警告メッセージ', severity: 'warning'},
    'https://example.com/',
    'sess_1'
  );
  assert.match(warning.title, /【警告】/);

  const info = buildPagerAlertPayload(
    {title: 'テスト', briefing: []},
    {message: '通知メッセージ', severity: 'info'},
    'https://example.com/',
    'sess_1'
  );
  assert.match(info.title, /【通知】/);
});

test('buildPagerChatPayload uses the sender name in the title and body text', () => {
  const payload = buildPagerChatPayload(
    {from: '田中さん', body: '状況どうですか?'},
    'https://example.com/',
    'sess_1'
  );
  assert.match(payload.title, /田中さん/);
  assert.equal(payload.body, '状況どうですか?');
  assert.equal(payload.tag, 'pager-sess_1');
});

test('shouldThrottlePagerAlert blocks sends within the minimum interval', () => {
  assert.equal(shouldThrottlePagerAlert(1_000, 1_000 + 5_000), true);
  assert.equal(
    shouldThrottlePagerAlert(1_000, 1_000 + PAGER_ALERT_MIN_INTERVAL_MS),
    false
  );
  assert.equal(
    shouldThrottlePagerAlert(1_000, 1_000 + PAGER_ALERT_MIN_INTERVAL_MS + 1),
    false
  );
});

test('shouldThrottlePagerAlert accepts a custom interval', () => {
  assert.equal(shouldThrottlePagerAlert(0, 4_999, 5_000), true);
  assert.equal(shouldThrottlePagerAlert(0, 5_000, 5_000), false);
});
