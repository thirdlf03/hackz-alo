import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {finalizeAssistAnswer} = await tsImport(
  '../../apps/web/src/pure/assistAnswerPipeline.ts',
  import.meta.url
);

test('finalizeAssistAnswer blocks a grounded-but-catastrophic rm, overriding an "ok" grounding verdict', () => {
  // Realistic case from the audit: a prompt-injected chat line hands the
  // model a real, on-screen `sudo rm -rf /workspace`, and grounding
  // legitimately says "ok" because the text is literally on screen.
  const answer =
    '次の一手: sudo rm -rf /workspace 一番早いです。\n根拠: チャットの発言を参照しました。';
  const grounding = {
    status: 'ok',
    nextStep: '次の一手: sudo rm -rf /workspace 一番早いです',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'danger_blocked');
  assert.ok(result.nextStep?.reason);
  assert.equal(result.prose, '根拠: チャットの発言を参照しました。');
});

test('finalizeAssistAnswer downgrades a targeted rm to danger_confirm, not danger_blocked', () => {
  const answer =
    '次の一手: rm -rf /workspace/logs/* でログを掃除する。\n根拠: ディスク逼迫の対処です。';
  const grounding = {
    status: 'ok',
    nextStep: '次の一手: rm -rf /workspace/logs/* でログを掃除する',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'danger_confirm');
  assert.ok(result.nextStep?.reason);
});

test('finalizeAssistAnswer keeps a repaired command as a non-auto-replaced candidate', () => {
  const answer = '次の一手: ss -lt で確認する。\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {
    status: 'repaired',
    nextStep: '次の一手: ss -lt で確認する',
    repairedNextStep: 'ss -ltnp',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'repair_candidate');
  assert.equal(result.nextStep?.command, grounding.nextStep);
  assert.equal(result.nextStep?.repairSuggestion, 'ss -ltnp');
});

test('finalizeAssistAnswer keeps a rejected (unverifiable, non-dangerous) command rejected', () => {
  const answer =
    '次の一手: kubectl rollout restart deployment/api を実行する。\n根拠: 一般知識。';
  const grounding = {
    status: 'rejected',
    nextStep: '次の一手: kubectl rollout restart deployment/api を実行する',
    reason: 'unverifiable command: kubectl',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'rejected');
  assert.equal(result.nextStep?.reason, grounding.reason);
});

test('finalizeAssistAnswer overrides a rejected verdict when the command is also dangerous', () => {
  const answer = '次の一手: sudo rm -rf / を実行する。\n根拠: なし。';
  const grounding = {
    status: 'rejected',
    nextStep: '次の一手: sudo rm -rf / を実行する',
    reason: 'unverifiable command',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'danger_blocked');
});

test('finalizeAssistAnswer passes through unverified as-is when the command is safe', () => {
  const answer = '次の一手: DBを再起動する。\n根拠: 一般的な対処。';
  const grounding = {
    status: 'unverified',
    nextStep: '次の一手: dbを再起動する',
    reason: 'no-grounded-command',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'unverified');
  assert.equal(result.nextStep?.reason, grounding.reason);
});

test('finalizeAssistAnswer marks a clean, verified command as ok', () => {
  const answer =
    '次の一手: ss -ltnp で確認する。\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {status: 'ok', nextStep: '次の一手: ss -ltnp で確認する'};

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'ok');
  assert.equal(result.nextStep?.reason, undefined);
});

test('finalizeAssistAnswer returns no nextStep and full trimmed prose for no_next_step', () => {
  const answer = '一般的な確認項目としてログを見てください。';
  const grounding = {status: 'no_next_step'};

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep, undefined);
  assert.equal(result.prose, answer);
});
