import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {buildRunbookNextStepCard} = await tsImport(
  '../../apps/web/src/pure/runbookNextStepCard.ts',
  import.meta.url
);

test('buildRunbookNextStepCard returns a step card for the current step, including its command', () => {
  const resolved = [
    {
      step: {id: 's1', instruction: '一番目', command: 'df -h'},
      status: 'done',
    },
    {
      step: {
        id: 's2',
        instruction: '二番目を確認する',
        command: 'curl localhost:8080/health',
      },
      status: 'current',
    },
    {
      step: {id: 's3', instruction: '三番目'},
      status: 'pending',
    },
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.deepEqual(card, {
    kind: 'step',
    index: 2,
    total: 3,
    instruction: '二番目を確認する',
    command: 'curl localhost:8080/health',
    doneCount: 1,
    alreadyExecuted: false,
  });
});

test('buildRunbookNextStepCard returns all_done when every step is done or skipped', () => {
  const resolved = [
    {step: {id: 's1', instruction: '一番目'}, status: 'done'},
    {step: {id: 's2', instruction: '二番目'}, status: 'skipped'},
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.deepEqual(card, {kind: 'all_done', total: 2});
});

test('buildRunbookNextStepCard returns the step card, not all_done, when the first incomplete step is manually marked failed', () => {
  const resolved = [
    {
      step: {id: 's1', instruction: '一番目', command: 'df -h'},
      status: 'failed',
    },
    {step: {id: 's2', instruction: '二番目'}, status: 'pending'},
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.deepEqual(card, {
    kind: 'step',
    index: 1,
    total: 2,
    instruction: '一番目',
    command: 'df -h',
    doneCount: 0,
    alreadyExecuted: false,
  });
});

test('buildRunbookNextStepCard finds the current step past a mix of done and skipped steps', () => {
  const resolved = [
    {step: {id: 's1', instruction: '一番目'}, status: 'done'},
    {step: {id: 's2', instruction: '二番目'}, status: 'skipped'},
    {step: {id: 's3', instruction: '三番目'}, status: 'current'},
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.equal(card.kind, 'step');
  assert.equal(card.index, 3);
  assert.equal(card.doneCount, 1);
});

test('buildRunbookNextStepCard returns undefined for an empty resolved array', () => {
  assert.equal(buildRunbookNextStepCard([]), undefined);
});

test('buildRunbookNextStepCard marks alreadyExecuted true when the current step has evidence', () => {
  const resolved = [
    {
      step: {id: 's1', instruction: '一番目', command: 'df -h'},
      status: 'current',
      evidence: {kind: 'command_executed', command: 'df -h', at: 1000},
    },
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.equal(card.kind, 'step');
  assert.equal(card.alreadyExecuted, true);
});

test('buildRunbookNextStepCard counts doneCount across all steps, not just up to current', () => {
  const resolved = [
    {step: {id: 's1', instruction: '一番目'}, status: 'done'},
    {step: {id: 's2', instruction: '二番目'}, status: 'done'},
    {step: {id: 's3', instruction: '三番目'}, status: 'current'},
    {step: {id: 's4', instruction: '四番目'}, status: 'pending'},
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.equal(card.kind, 'step');
  assert.equal(card.doneCount, 2);
  assert.equal(card.total, 4);
});

test('buildRunbookNextStepCard omits command when the current step has none', () => {
  const resolved = [
    {step: {id: 's1', instruction: '状況を確認する'}, status: 'current'},
  ];
  const card = buildRunbookNextStepCard(resolved);
  assert.equal(card.kind, 'step');
  assert.equal('command' in card, false);
});
