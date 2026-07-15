import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {canCopyAssistCommand, resolveAnswerPresentation} = await tsImport(
  '../../apps/web/src/pure/assistAnswerPresentation.ts',
  import.meta.url
);

test('resolveAnswerPresentation demotes an "ok" command to a reference line for a why-question', () => {
  const finalized = {
    prose: '再起動は一時的解決であり根本原因ではありません。',
    nextStep: {command: 'ss -ltnp', verdict: 'ok'},
  };

  const result = resolveAnswerPresentation('why', finalized);

  assert.equal(result.mode, 'why_explanation');
  assert.equal(result.showCommandAs, 'reference');
});

test('resolveAnswerPresentation keeps the existing block display for a why-question with a dangerous command', () => {
  const finalized = {
    prose: '再起動は一時的解決であり根本原因ではありません。',
    nextStep: {
      command: 'sudo rm -rf /workspace',
      verdict: 'danger_blocked',
      reason: 'catastrophic filesystem deletion',
    },
  };

  const result = resolveAnswerPresentation('why', finalized);

  assert.equal(result.mode, 'next_step');
  assert.equal(result.showCommandAs, 'primary');
});

test('resolveAnswerPresentation keeps the existing primary command display for a next_step-question with an ok command', () => {
  const finalized = {
    prose: '根拠: RUNBOOKの記載に基づく。',
    nextStep: {command: 'ss -ltnp', verdict: 'ok'},
  };

  const result = resolveAnswerPresentation('next_step', finalized);

  assert.equal(result.mode, 'next_step');
  assert.equal(result.showCommandAs, 'primary');
});

test('resolveAnswerPresentation is prose-only for a why-question with no next step', () => {
  const finalized = {prose: '一般的な確認項目としてログを見てください。'};

  const result = resolveAnswerPresentation('why', finalized);

  assert.equal(result.mode, 'why_explanation');
  assert.equal(result.showCommandAs, 'hidden');
});

test('resolveAnswerPresentation keeps the existing display for a why-question with a redundant command', () => {
  const finalized = {
    prose: '再起動は一時的解決であり根本原因ではありません。',
    nextStep: {
      command: 'ss -ltnp',
      verdict: 'redundant',
      reason: '直近に実行済みのコマンドです',
    },
  };

  const result = resolveAnswerPresentation('why', finalized);

  assert.equal(result.mode, 'next_step');
  assert.equal(result.showCommandAs, 'primary');
});

test('resolveAnswerPresentation keeps the existing display for a why-question with a rejected command', () => {
  const finalized = {
    prose: '再起動は一時的解決であり根本原因ではありません。',
    nextStep: {
      command: 'kubectl rollout restart deployment/api',
      verdict: 'rejected',
      reason: 'unverifiable command: kubectl',
    },
  };

  const result = resolveAnswerPresentation('why', finalized);

  assert.equal(result.mode, 'next_step');
  assert.equal(result.showCommandAs, 'primary');
});

test('resolveAnswerPresentation is hidden for a non-why question with no next step', () => {
  const finalized = {prose: '一般的な確認項目としてログを見てください。'};

  const result = resolveAnswerPresentation('other', finalized);

  assert.equal(result.mode, 'next_step');
  assert.equal(result.showCommandAs, 'hidden');
});

test('canCopyAssistCommand allows copying a safely-grounded command', () => {
  assert.equal(canCopyAssistCommand('ok'), true);
});

test('canCopyAssistCommand allows copying a command that only needs manual confirmation', () => {
  assert.equal(canCopyAssistCommand('danger_confirm'), true);
});

test('canCopyAssistCommand refuses to copy blocked, rejected, or downgraded commands', () => {
  assert.equal(canCopyAssistCommand('danger_blocked'), false);
  assert.equal(canCopyAssistCommand('rejected'), false);
  assert.equal(canCopyAssistCommand('redundant'), false);
});

test('canCopyAssistCommand refuses to copy commands that are not fully vetted', () => {
  assert.equal(canCopyAssistCommand('unverified'), false);
  assert.equal(canCopyAssistCommand('repair_candidate'), false);
  assert.equal(canCopyAssistCommand('request_context'), false);
});
