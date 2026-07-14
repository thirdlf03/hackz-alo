import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';

const {
  parseRunbookSteps,
  hashRunbookBody,
  deriveStepEvidence,
  resolveStepStatuses,
} = await tsImport('../../apps/web/src/pure/runbookSteps.ts', import.meta.url);

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const scenarioDataDir = path.join(rootDir, 'packages/scenarios/data');
const goldenFixturePath = path.join(
  rootDir,
  'tests/unit/fixtures/runbook-steps-golden.json'
);

test('parseRunbookSteps splits numbered lines into steps with instruction text', () => {
  const steps = parseRunbookSteps(
    '1. df -h で全体の使用率を見る\n2. curl localhost:8080/health で復旧確認する'
  );
  assert.equal(steps.length, 2);
  assert.equal(steps[0].instruction, 'df -h で全体の使用率を見る');
  assert.equal(steps[0].command, 'df -h');
  assert.equal(
    steps[1].instruction,
    'curl localhost:8080/health で復旧確認する'
  );
  assert.equal(steps[1].command, 'curl localhost:8080/health');
});

test('parseRunbookSteps handles literal \\n one-line bodies (existing fixture style)', () => {
  const body =
    '1. df -h で全体の使用率を見る\\n2. du -sh /workspace/logs/* で特定する\\n3. curl localhost:8080/health で復旧確認する';
  const steps = parseRunbookSteps(body);
  assert.equal(steps.length, 3);
  assert.equal(steps[1].command, 'du -sh /workspace/logs/*');
});

test('parseRunbookSteps joins non-numbered continuation lines into the preceding step', () => {
  const body = [
    '2. API 自体の問題か、依存先(DB)の問題かを分ける',
    '   yamactl status api / yamactl status fake-db',
    '3. 依存先が死んでいたら復旧する(yamactl restart fake-db)',
  ].join('\n');
  const steps = parseRunbookSteps(body);
  assert.equal(steps.length, 2);
  assert.match(
    steps[0].instruction,
    /yamactl status api \/ yamactl status fake-db$/
  );
  assert.equal(steps[0].command, 'yamactl status api');
  assert.equal(steps[1].command, 'yamactl restart fake-db');
});

test('parseRunbookSteps returns an empty array for freeform bodies without numbered lines', () => {
  const steps = parseRunbookSteps(
    'yamactl restart api で再起動する。それで直る。いつも直ってきた。'
  );
  assert.deepEqual(steps, []);
});

test('parseRunbookSteps returns an empty array for gaslight-style replacement text', () => {
  const steps = parseRunbookSteps('気合いで直す。根性。深呼吸。');
  assert.deepEqual(steps, []);
});

test('parseRunbookSteps returns the RunbookDefinition.steps override verbatim when provided', () => {
  const overrideSteps = [
    {id: 'custom-1', instruction: 'カスタム手順1', command: 'echo hi'},
  ];
  const steps = parseRunbookSteps(
    '1. これはパースされないはずの本文\n2. 二行目',
    overrideSteps
  );
  assert.deepEqual(steps, overrideSteps);
});

test('parseRunbookSteps does not extract a command when no ASCII command-like token is present', () => {
  const steps = parseRunbookSteps(
    '1. 表示されている情報そのものの信頼性を疑ってかかる'
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].command, undefined);
});

test('hashRunbookBody is stable for identical input and changes when body changes', () => {
  const bodyA = '1. df -h で見る';
  const bodyB = '1. df -h で見る（改ざん済み）';
  assert.equal(hashRunbookBody(bodyA), hashRunbookBody(bodyA));
  assert.notEqual(hashRunbookBody(bodyA), hashRunbookBody(bodyB));
});

test('deriveStepEvidence only attaches evidence for a normalized full match', () => {
  const steps = parseRunbookSteps(
    '1. df -h で全体の使用率を見る\n2. curl localhost:8080/health で復旧確認する'
  );
  const commandHistory = [
    {at: 1000, command: '  df   -h  '},
    {at: 2000, command: 'curl localhost:8080/health --verbose'},
  ];
  const evidence = deriveStepEvidence(steps, commandHistory);
  assert.equal(evidence[steps[0].id]?.at, 1000);
  assert.equal(evidence[steps[0].id]?.command, 'df -h');
  // Step 2's real command differs from history by a trailing flag: a prefix
  // match must NOT count as evidence (完全一致のみ).
  assert.equal(evidence[steps[1].id], undefined);
});

test('deriveStepEvidence picks the first matching history entry when duplicated', () => {
  const steps = parseRunbookSteps('1. df -h で見る');
  const commandHistory = [
    {at: 500, command: 'df -h'},
    {at: 900, command: 'df -h'},
  ];
  const evidence = deriveStepEvidence(steps, commandHistory);
  assert.equal(evidence[steps[0].id]?.at, 500);
});

test('resolveStepStatuses defaults the first step to current and the rest to pending', () => {
  const steps = parseRunbookSteps(
    '1. 一番目\n2. curl localhost:8080/health で確認する\n3. 三番目'
  );
  const resolved = resolveStepStatuses(steps, undefined);
  assert.deepEqual(
    resolved.map((entry) => entry.status),
    ['current', 'pending', 'pending']
  );
});

test('resolveStepStatuses prioritizes manualStatus over evidence-only pending', () => {
  const steps = parseRunbookSteps(
    '1. 一番目\n2. curl localhost:8080/health で確認する'
  );
  const progress = {
    runbookId: 'rb',
    bodyHash: 'h',
    steps: [
      {
        stepId: steps[1].id,
        evidence: {
          kind: 'command_executed',
          command: 'curl localhost:8080/health',
          at: 123,
        },
      },
    ],
  };
  const resolved = resolveStepStatuses(steps, progress);
  // Evidence alone must not promote a step past pending/current.
  assert.equal(resolved[1].status, 'pending');
  assert.equal(resolved[1].evidence?.at, 123);

  const doneProgress = {
    runbookId: 'rb',
    bodyHash: 'h',
    steps: [{stepId: steps[0].id, manualStatus: 'done'}],
  };
  const resolvedDone = resolveStepStatuses(steps, doneProgress);
  assert.equal(resolvedDone[0].status, 'done');
  // current should move on to the next incomplete step.
  assert.equal(resolvedDone[1].status, 'current');
});

test('resolveStepStatuses keeps manualStatus "failed" instead of relabeling it current', () => {
  const steps = parseRunbookSteps('1. 一番目\n2. 二番目');
  const progress = {
    runbookId: 'rb',
    bodyHash: 'h',
    steps: [{stepId: steps[0].id, manualStatus: 'failed'}],
  };
  const resolved = resolveStepStatuses(steps, progress);
  assert.equal(resolved[0].status, 'failed');
  assert.equal(resolved[1].status, 'pending');
});

test('golden: parseRunbookSteps output for every scenario runbook body matches the recorded fixture', async () => {
  const files = (await readdir(scenarioDataDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  assert.equal(files.length, 20);

  const golden = JSON.parse(await readFile(goldenFixturePath, 'utf8'));

  const actual = {};
  for (const file of files) {
    const scenario = JSON.parse(
      await readFile(path.join(scenarioDataDir, file), 'utf8')
    );
    const runbooks = {};
    for (const runbook of scenario.runbooks) {
      const steps = parseRunbookSteps(runbook.body, runbook.steps);
      runbooks[runbook.id] = steps.map((step) => ({
        instruction: step.instruction,
        command: step.command ?? null,
      }));
    }
    actual[scenario.id] = runbooks;
  }

  assert.deepEqual(actual, golden);
});
