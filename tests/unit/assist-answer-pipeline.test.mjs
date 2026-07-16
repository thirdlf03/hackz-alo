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
  assert.equal(result.nextStep?.command, 'ss -lt で確認する');
  assert.ok(!result.nextStep?.command.includes('次の一手'));
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

test('finalizeAssistAnswer downgrades a next step matching an already-executed command to redundant', () => {
  const answer = '次の一手: ss -ltnp\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {status: 'ok', nextStep: '次の一手: ss -ltnp'};
  const recentCommands = [
    {command: 'ss -ltnp', at: Date.now() - 1000},
    {command: 'cat /var/log/app.log', at: Date.now() - 2000},
  ];

  const result = finalizeAssistAnswer(answer, grounding, recentCommands);

  assert.equal(result.nextStep?.verdict, 'redundant');
  assert.equal(result.nextStep?.reason, '直近に実行済みのコマンドです');
});

test('finalizeAssistAnswer matches redundant commands despite backtick/whitespace notational differences', () => {
  const answer = '次の一手: `ss  -ltnp`\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {
    status: 'ok',
    nextStep: '次の一手: `ss  -ltnp`',
  };
  const recentCommands = [{command: 'ss -ltnp', at: Date.now() - 1000}];

  const result = finalizeAssistAnswer(answer, grounding, recentCommands);

  assert.equal(result.nextStep?.verdict, 'redundant');
});

test('finalizeAssistAnswer keeps a non-executed command verdict unchanged (not redundant)', () => {
  const answer =
    '次の一手: ss -ltnp で確認する。\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {status: 'ok', nextStep: '次の一手: ss -ltnp で確認する'};
  const recentCommands = [{command: 'df -h', at: Date.now() - 1000}];

  const result = finalizeAssistAnswer(answer, grounding, recentCommands);

  assert.equal(result.nextStep?.verdict, 'ok');
});

test('finalizeAssistAnswer prioritizes danger over redundant when both apply', () => {
  const answer = '次の一手: sudo rm -rf /workspace\n根拠: なし。';
  const grounding = {
    status: 'ok',
    nextStep: '次の一手: sudo rm -rf /workspace',
  };
  const recentCommands = [
    {command: 'sudo rm -rf /workspace', at: Date.now() - 1000},
  ];

  const result = finalizeAssistAnswer(answer, grounding, recentCommands);

  assert.equal(result.nextStep?.verdict, 'danger_blocked');
});

test('finalizeAssistAnswer treats a leading "不足:" next step as request_context', () => {
  const answer =
    '次の一手: 不足: ターミナルの最新出力\n根拠: 画像に該当情報がありません。';
  const grounding = {
    status: 'unverified',
    nextStep: '次の一手: 不足: ターミナルの最新出力',
    reason: 'no-grounded-command',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'request_context');
  assert.equal(result.nextStep?.requestedInfo, 'ターミナルの最新出力');
  assert.equal(result.nextStep?.command, undefined);
});

test('finalizeAssistAnswer falls back to normal classification when "不足" is not at the start', () => {
  const answer =
    '次の一手: ss -ltnp で確認する(不足していれば再確認)。\n根拠: RUNBOOKの記載に基づく。';
  const grounding = {
    status: 'ok',
    nextStep: '次の一手: ss -ltnp で確認する(不足していれば再確認)',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'ok');
  assert.equal(result.nextStep?.requestedInfo, undefined);
});

test('finalizeAssistAnswer does not apply danger classification to a "不足:" request_context', () => {
  const answer =
    '次の一手: 不足: sudo rm -rf /workspace の実行結果\n根拠: 画像に写っていません。';
  const grounding = {
    status: 'unverified',
    nextStep: '次の一手: 不足: sudo rm -rf /workspace の実行結果',
    reason: 'no-grounded-command',
  };

  const result = finalizeAssistAnswer(answer, grounding);

  assert.equal(result.nextStep?.verdict, 'request_context');
});

test('finalizeAssistAnswer does not apply the redundant check to a "不足:" request_context', () => {
  const answer =
    '次の一手: 不足: ss -ltnpの実行結果\n根拠: 画像に写っていません。';
  const grounding = {
    status: 'unverified',
    nextStep: '次の一手: 不足: ss -ltnpの実行結果',
    reason: 'no-grounded-command',
  };
  const recentCommands = [{command: 'ss -ltnp', at: Date.now() - 1000}];

  const result = finalizeAssistAnswer(answer, grounding, recentCommands);

  assert.equal(result.nextStep?.verdict, 'request_context');
});
