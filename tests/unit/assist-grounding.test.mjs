import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {groundAssistNextStep, extractNextStepText, normalizeForGrounding} = await tsImport(
  '../../apps/web/src/pure/assistGrounding.ts',
  import.meta.url
);

test('exact match of a screen command is ok', () => {
  const result = groundAssistNextStep(
    '次の一手: `cat /workspace/run/fake-db-stats.json` を実行して犯人プロセスを特定する\n根拠: DB Conn が 40/40 です。',
    ['TERMINAL: $ cat /workspace/run/fake-db-stats.json']
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.reason, undefined);
});

test('a fully copied NEXT column is ok', () => {
  const result = groundAssistNextStep(
    '次の一手: yamactl restart api --confirm\n根拠: NEXTの手順通り。',
    ['NEXT: yamactl restart api --confirm']
  );
  assert.equal(result.status, 'ok');
});

test('a fabricated kubectl command is rejected', () => {
  const result = groundAssistNextStep(
    '次の一手: `kubectl rollout restart deployment/api` を実行する\n根拠: DB接続プールが枯渇しているため。',
    [
      'SERVICE HEALTH   DEGRADED',
      'DB CONN          40/40',
      'ALERT: DB connection pool exhausted',
      'ALERT: HTTP 5xx rate is above threshold',
      'TERMINAL: $ cat /workspace/run/fake-db-stats.json',
      'RUNBOOK: DB を再起動しても、犯人が生きていればすぐ再発する',
    ]
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /kubectl/);
});

test('a truncated but real path is repaired to the complete screen path', () => {
  const result = groundAssistNextStep(
    '次の一手: `cp /workspace/docs/backups/service-recovery.md /workspace/docs/runbooks/service-recovery-`\n根拠: バックアップから復元する。',
    [
      'SERVICE HEALTH   OK',
      'ALERT: Runbook integrity check failed',
      'RUNBOOK: 気合いで直す。根性。深呼吸。',
      'CHAT: 先輩: Wiki 壊れてる。Runbook 信じないで。',
      'TERMINAL: $ ls /workspace/docs/backups',
      'TERMINAL: $ cp /workspace/docs/backups/service-recovery.md /workspace/docs/runbooks/service-recovery.md',
    ]
  );
  assert.equal(result.status, 'repaired');
  assert.match(result.repairedNextStep, /\/workspace\/docs\/runbooks\/service-recovery\.md/);
});

test('a missing 次の一手 marker is no_next_step', () => {
  const result = groundAssistNextStep(
    '状況を確認してください。根拠: アラートが出ています。',
    ['ALERT: 何かが起きている']
  );
  assert.equal(result.status, 'no_next_step');
  assert.equal(result.nextStep, undefined);
});

test('a next step made only of Japanese operational text with no matching screen line is unverified, not rejected', () => {
  const result = groundAssistNextStep(
    '次の一手: 落ち着いてログを確認する\n根拠: 状況が不明なため。',
    ['ALERT: 何かが起きている']
  );
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'no-grounded-command');
});

test('an arrow written as → matches the same content written as -> on screen', () => {
  const result = groundAssistNextStep(
    '次の一手: サービス停止 → 再起動 の順で対応する\n根拠: 手順通り。',
    ['サービス停止 -> 再起動 の順で対応する']
  );
  assert.equal(result.status, 'ok');
});

test('extractNextStepText returns the section between 次の一手 and 根拠', () => {
  assert.equal(
    extractNextStepText('状況は不明。次の一手: ss -ltnp を実行する。根拠: health が unknown のまま。'),
    '次の一手: ss -ltnp を実行する。'
  );
  assert.equal(extractNextStepText('根拠だけの回答です。'), '');
});

test('normalizeForGrounding collapses full-width spacing and unifies arrow glyphs', () => {
  assert.equal(
    normalizeForGrounding('サービスA　→　サービスB'),
    'サービスa -> サービスb'
  );
  assert.equal(normalizeForGrounding('`ss -ltnp`'), 'ss -ltnp');
});

test('a next step copying only the first half of an on-screen NEXT chain is completed', () => {
  const result = groundAssistNextStep(
    '次の一手: yamactl restart api\n根拠: NEXTの通りに再起動する。',
    ['NEXT: yamactl restart api → curl localhost:8080/health']
  );
  assert.equal(result.status, 'repaired');
  assert.equal(result.reason, 'next-chain-completed');
  assert.equal(result.repairedNextStep, 'yamactl restart api -> curl localhost:8080/health');
});

test('a next step that already copied the whole NEXT chain stays ok', () => {
  const result = groundAssistNextStep(
    '次の一手: yamactl restart api -> curl localhost:8080/health\n根拠: NEXTの通りに実行する。',
    ['NEXT: yamactl restart api -> curl localhost:8080/health']
  );
  assert.equal(result.status, 'ok');
});

test('the chain completion rule also fires for an ASCII -> chain on screen', () => {
  const result = groundAssistNextStep(
    '次の一手: yamactl restart api\n根拠: NEXTの通りに再起動する。',
    ['NEXT: yamactl restart api -> curl localhost:8080/health']
  );
  assert.equal(result.status, 'repaired');
  assert.equal(result.reason, 'next-chain-completed');
  assert.equal(result.repairedNextStep, 'yamactl restart api -> curl localhost:8080/health');
});

test('a fabricated command outside any on-screen chain is still rejected', () => {
  const result = groundAssistNextStep(
    '次の一手: `kubectl rollout restart deployment/api`\n根拠: 念のため再起動する。',
    ['NEXT: yamactl restart api → curl localhost:8080/health']
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /kubectl/);
});

test('a fragmentary paraphrase of a much longer RUNBOOK sentence is unverified', () => {
  const result = groundAssistNextStep(
    '次の一手: DBを再起動する\n根拠: DB接続プールが枯渇しているため。',
    [
      'DB CONN          40/40',
      'ALERT: DB connection pool exhausted',
      'RUNBOOK: DB を再起動しても、犯人が生きていればすぐ再発する',
      'CHAT: 先輩(仮眠中): ん…月次レポートのバッチ、今夜だったかも…zzz',
    ]
  );
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'no-grounded-command');
});

test('a chat message promoted verbatim to the next step is unverified as chat-prose', () => {
  // Neither "監視、たまに死ぬんだよな…気づいたら直しといて…" nor the source CHAT
  // line contain an ASCII command token ("zzz" is 3 chars, below the 4-char
  // candidate threshold), so this exercises the zero-candidate branch: it is
  // a substantial (>=70%) copy of a screen line, but that line is CHAT-
  // prefixed (a colleague's remark, not an instruction), so it is unverified.
  const result = groundAssistNextStep(
    '次の一手: 監視、たまに死ぬんだよな…気づいたら直しといて…\n根拠: チャットの指摘の通り。',
    [
      'CPU USAGE        NO DATA',
      'SERVICE HEALTH   DOWN',
      'RUNBOOK: app.log で monitor-agent と api、それぞれの生死を個別に確認する',
      'CHAT: 先輩(仮眠中): 監視、たまに死ぬんだよな…気づいたら直しといて…zzz',
    ]
  );
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'chat-prose');
});

test('a near-full copy of a RUNBOOK line (>=70% coverage) stays ok as a line-copy', () => {
  // No ASCII token >=4 chars here either ("db" is 2 chars), so this also
  // exercises the zero-candidate branch: a substantial copy of a non-CHAT
  // (RUNBOOK) line is trusted as a grounded, if unverifiable-as-a-command,
  // instruction.
  const result = groundAssistNextStep(
    '次の一手: DB を再起動しても、犯人が生きていればすぐ再発する\n根拠: DB接続プールが枯渇しているため。',
    [
      'DB CONN          40/40',
      'ALERT: DB connection pool exhausted',
      'RUNBOOK: DB を再起動しても、犯人が生きていればすぐ再発する',
      'CHAT: 先輩(仮眠中): ん…月次レポートのバッチ、今夜だったかも…zzz',
    ]
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.reason, 'line-copy');
});

test('a chat-derived next step that does contain a real command is still ok, unaffected by the chat-prose rule', () => {
  const result = groundAssistNextStep(
    '次の一手: `ss -ltnp` を実行してポートの占有を確認する\n根拠: 再起動しても health が unknown のままのため。',
    [
      'SERVICE HEALTH   DEGRADED',
      'RUNBOOK: yamactl restart api で再起動する。それで直る。いつも直ってきた。',
      'CHAT: 先輩(仮眠中): ポート見てみ。ss -ltnp',
    ]
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.reason, undefined);
});
