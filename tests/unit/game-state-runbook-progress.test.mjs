import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';

const {createInitialGameState, advanceGameState, markRunbookStep} =
  await tsImport('../../apps/web/src/game/state/gameState.ts', import.meta.url);
const {reduceGameState} = await tsImport(
  '../../apps/web/src/game/state/gameStateReduce.ts',
  import.meta.url
);

function fakeTerminal(commandHistory = []) {
  return {
    cols: 80,
    rows: 24,
    lines: [''],
    cursor: {x: 0, y: 0, visible: true},
    commandDraft: '',
    commandHistory,
  };
}

function fakeScenario(body, overrides = {}) {
  return {
    id: 'scenario-1',
    version: 1,
    title: 'テスト用シナリオ',
    difficulty: 'beginner',
    difficultyScore: 1,
    timeLimitMinutes: 20,
    service: {name: 'api', healthUrl: 'http://localhost:8080/health'},
    briefing: [],
    startup: [],
    triggers: [],
    alerts: [],
    successConditions: [],
    runbooks: [{id: 'rb1', title: '対応手順', body, availableAtMs: 0}],
    chatMessages: [],
    ...overrides,
  };
}

const BODY_TWO_STEPS =
  '1. df -h で全体の使用率を見る\n2. curl localhost:8080/health で復旧確認する';

function withCommandHistory(state, commandHistory) {
  return {
    ...state,
    monitors: {
      ...state.monitors,
      center: {
        ...state.monitors.center,
        terminal: {...state.monitors.center.terminal, commandHistory},
      },
    },
  };
}

test('advanceGameState derives runbookProgress from the active runbook body', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal()
  );
  const next = advanceGameState(initial, 1000, scenario);
  assert.ok(next.runbookProgress);
  assert.equal(next.runbookProgress.runbookId, 'rb1');
  assert.deepEqual(next.runbookProgress.steps, []);
});

test('advanceGameState attaches evidence once a matching command is executed', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal()
  );
  const withHistory = withCommandHistory(initial, [
    {at: 5000, command: 'df -h'},
  ]);
  const next = advanceGameState(withHistory, 1000, scenario);
  assert.equal(next.runbookProgress.steps.length, 1);
  const [entry] = next.runbookProgress.steps;
  assert.equal(entry.evidence.command, 'df -h');
  assert.equal(entry.evidence.at, 5000);
  assert.equal(entry.manualStatus, undefined);
});

test('advanceGameState returns the same runbookProgress reference when nothing changed', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal([{at: 5000, command: 'df -h'}])
  );
  const first = advanceGameState(initial, 1000, scenario);
  const second = advanceGameState(first, 1500, scenario);
  assert.strictEqual(first.runbookProgress, second.runbookProgress);
});

test('advanceGameState resets runbookProgress when the runbook body changes (gaslight-style rewrite)', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal([{at: 5000, command: 'df -h'}])
  );
  const withEvidence = advanceGameState(initial, 1000, scenario);
  const marked = markRunbookStep(
    withEvidence,
    'rb1',
    withEvidence.runbookProgress.bodyHash,
    withEvidence.runbookProgress.steps[0].stepId,
    'done'
  );
  assert.equal(marked.runbookProgress.steps[0].manualStatus, 'done');

  // gaslight rewrites the runbook file down to a freeform (non-numbered)
  // paragraph — parseRunbookSteps naturally yields zero steps for it.
  const gaslitScenario = fakeScenario('気合いで直す。根性。深呼吸。');
  const rewritten = advanceGameState(marked, 2000, gaslitScenario);
  assert.notEqual(
    rewritten.runbookProgress.bodyHash,
    marked.runbookProgress.bodyHash
  );
  assert.deepEqual(rewritten.runbookProgress.steps, []);
});

test('mark_runbook_step reducer sets, overrides, and clears manualStatus', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal()
  );
  const derived = advanceGameState(initial, 1000, scenario);
  const bodyHash = derived.runbookProgress.bodyHash;

  const marked = reduceGameState(derived, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId: 'step-1',
    status: 'done',
  });
  assert.equal(marked.runbookProgress.steps[0].manualStatus, 'done');

  const overridden = reduceGameState(marked, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId: 'step-1',
    status: 'failed',
  });
  assert.equal(overridden.runbookProgress.steps[0].manualStatus, 'failed');

  const cleared = reduceGameState(overridden, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId: 'step-1',
    status: null,
  });
  assert.deepEqual(cleared.runbookProgress.steps, []);
});

test('mark_runbook_step reducer preserves evidence when clearing manualStatus', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal([{at: 5000, command: 'df -h'}])
  );
  const withEvidence = advanceGameState(initial, 1000, scenario);
  const bodyHash = withEvidence.runbookProgress.bodyHash;
  const stepId = withEvidence.runbookProgress.steps[0].stepId;

  const marked = reduceGameState(withEvidence, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId,
    status: 'done',
  });
  const cleared = reduceGameState(marked, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId,
    status: null,
  });
  assert.equal(cleared.runbookProgress.steps.length, 1);
  assert.equal(cleared.runbookProgress.steps[0].manualStatus, undefined);
  assert.equal(cleared.runbookProgress.steps[0].evidence.command, 'df -h');
});

test('mark_runbook_step reducer is a no-op when clearing a step with no prior state', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal()
  );
  const derived = advanceGameState(initial, 1000, scenario);
  const bodyHash = derived.runbookProgress.bodyHash;

  const result = reduceGameState(derived, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash,
    stepId: 'step-1',
    status: null,
  });
  assert.strictEqual(result, derived);
});

test('mark_runbook_step reducer discards stale progress from a different bodyHash', () => {
  const scenario = fakeScenario(BODY_TWO_STEPS);
  const initial = createInitialGameState(
    scenario,
    'session-1',
    'replay-1',
    fakeTerminal()
  );
  const derived = advanceGameState(initial, 1000, scenario);
  const staleBodyHash = 'deadbeef';

  const result = reduceGameState(derived, {
    type: 'mark_runbook_step',
    runbookId: 'rb1',
    bodyHash: staleBodyHash,
    stepId: 'step-1',
    status: 'done',
  });
  assert.equal(result.runbookProgress.bodyHash, staleBodyHash);
  assert.equal(result.runbookProgress.steps.length, 1);
  assert.equal(result.runbookProgress.steps[0].manualStatus, 'done');
});
