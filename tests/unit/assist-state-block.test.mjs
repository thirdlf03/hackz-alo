import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {buildAssistStateBlock, MAX_STATE_BLOCK_LINES} = await tsImport(
  '../../apps/web/src/pure/assistStateBlock.ts',
  import.meta.url
);

const NOW = Date.parse('2026-07-15T12:00:00Z');

test('buildAssistStateBlock returns undefined when no data is available', () => {
  assert.equal(buildAssistStateBlock({}), undefined);
  assert.equal(buildAssistStateBlock({commandHistory: []}), undefined);
});

test('buildAssistStateBlock renders every line when all data is present', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    recoveryLastCheck: {
      allOk: false,
      checks: [
        {label: 'health が 200', ok: true},
        {label: '/workspace のディスク使用率 80% 未満', ok: false},
        {label: 'api プロセス稼働', ok: true},
      ],
    },
    commandHistory: [
      {at: NOW - 3 * 60_000, command: 'yamactl restart api'},
      {at: NOW - 60_000, command: 'curl localhost:8080/health'},
    ],
    currentStep: {
      index: 3,
      instruction: 'tail で中身を確認し、消してよいログか判断する',
    },
    lastExchange: {
      question: 'apiが落ちた',
      suggestion: 'yamactl restart api',
    },
  });

  const expected = [
    '【現在の状態】',
    '成功条件: 2/3 達成(未達: /workspace のディスク使用率 80% 未満)',
    '直近の操作: yamactl restart api(3分前)/ curl localhost:8080/health(1分前)',
    '現在の手順: 3. tail で中身を確認し、消してよいログか判断する',
    '直前のやりとり: Q「apiが落ちた」→ 提案「yamactl restart api」',
  ].join('\n');
  assert.equal(text, expected);
});

test('buildAssistStateBlock keeps output within MAX_STATE_BLOCK_LINES lines', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    recoveryLastCheck: {allOk: true, checks: [{label: 'ok', ok: true}]},
    commandHistory: [{at: NOW - 60_000, command: 'ls'}],
    currentStep: {index: 1, instruction: '確認する'},
    lastExchange: {question: 'Q', suggestion: 'S'},
  });
  assert.ok(text !== undefined);
  const lines = text.split('\n');
  assert.ok(lines.length <= MAX_STATE_BLOCK_LINES);
});

test('buildAssistStateBlock shows a plain achieved count with no parenthetical when all conditions are met', () => {
  const text = buildAssistStateBlock({
    recoveryLastCheck: {
      allOk: true,
      checks: [
        {label: 'health が 200', ok: true},
        {label: 'api プロセス稼働', ok: true},
      ],
    },
  });
  assert.match(text, /^成功条件: 2\/2 達成$/m);
  assert.equal(text.includes('未達'), false);
});

test('buildAssistStateBlock falls back to 未確認 when recoveryLastCheck is absent', () => {
  const text = buildAssistStateBlock({
    commandHistory: [{at: NOW, command: 'ls'}],
    now: NOW,
  });
  assert.match(text, /^成功条件: 未確認$/m);
});

test('buildAssistStateBlock formats relative time as たった今 under 60 seconds', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    commandHistory: [{at: NOW - 30_000, command: 'ls'}],
  });
  assert.match(text, /直近の操作: ls\(たった今\)/);
});

test('buildAssistStateBlock keeps only the two most recent commands', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    commandHistory: [
      {at: NOW - 5 * 60_000, command: 'df -h'},
      {at: NOW - 3 * 60_000, command: 'yamactl restart api'},
      {at: NOW - 60_000, command: 'curl localhost:8080/health'},
    ],
  });
  assert.equal(text.includes('df -h'), false);
  assert.match(
    text,
    /直近の操作: yamactl restart api\(3分前\)\/ curl localhost:8080\/health\(1分前\)/
  );
});

test('buildAssistStateBlock omits lines whose data is missing (partial input)', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    currentStep: {index: 2, instruction: '状況を確認する'},
  });
  const expected = [
    '【現在の状態】',
    '成功条件: 未確認',
    '現在の手順: 2. 状況を確認する',
  ].join('\n');
  assert.equal(text, expected);
  assert.equal(text.includes('直近の操作'), false);
  assert.equal(text.includes('直前のやりとり'), false);
});

test('buildAssistStateBlock omits the last-exchange line when lastExchange is absent', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    recoveryLastCheck: {allOk: true, checks: [{label: 'ok', ok: true}]},
  });
  assert.equal(text.includes('直前のやりとり'), false);
});

test('buildAssistStateBlock omits the 提案 part when lastExchange has no suggestion', () => {
  const text = buildAssistStateBlock({
    now: NOW,
    lastExchange: {question: 'どうすればいい?'},
  });
  assert.match(text, /直前のやりとり: Q「どうすればいい\?」$/m);
  assert.equal(text.includes('提案'), false);
});
