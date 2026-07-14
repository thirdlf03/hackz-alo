import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {checkRecoveryAction} = await tsImport(
  '../../apps/worker/src/durable/sessionRecoveryCheck.ts',
  import.meta.url
);

// process-stop-001 has one trigger (stop-api) and two successConditions
// (http_status + process_running), which lets us drive both the
// undeclarable (no trigger fired) and declarable (trigger fired) paths.
const SCENARIO_ID = 'process-stop-001';

function baseSession(overrides = {}) {
  return {
    sessionId: 'sess_recovery_check',
    replayId: 'repl_recovery_check',
    scenarioId: SCENARIO_ID,
    status: 'running',
    gameTimeMs: 0,
    gameSpeed: 1,
    gameClockWallMs: Date.now(),
    triggeredIds: [],
    firedAlertIds: [],
    firedChatIds: [],
    eventSeq: 0,
    bufferedEvents: [],
    ...overrides,
  };
}

test('checkRecoveryAction returns declarable:false and skips the sandbox evaluator when the trigger has not fired', async () => {
  const session = baseSession({triggeredIds: []});
  let evaluateCalls = 0;
  const result = await checkRecoveryAction(session, {
    env: {},
    evaluateCondition: async () => {
      evaluateCalls += 1;
      return true;
    },
  });

  assert.deepEqual(
    {declarable: result.declarable, allOk: result.allOk, checks: result.checks},
    {declarable: false, allOk: false, checks: []}
  );
  assert.equal(typeof result.evaluatedAt, 'number');
  assert.equal(evaluateCalls, 0, 'sandbox exec skipped when not declarable');
});

test('checkRecoveryAction evaluates every successCondition once triggers have fired', async () => {
  const session = baseSession({triggeredIds: ['stop-api']});
  const seenConditions = [];
  const result = await checkRecoveryAction(session, {
    env: {},
    evaluateCondition: async (_env, sessionId, condition) => {
      seenConditions.push(condition.type);
      assert.equal(sessionId, session.sessionId);
      return true;
    },
  });

  assert.equal(result.declarable, true);
  assert.equal(result.allOk, true);
  assert.equal(result.checks.length, 2);
  assert.deepEqual(seenConditions, ['http_status', 'process_running']);
});

test('checkRecoveryAction reports allOk:false when any successCondition fails', async () => {
  const session = baseSession({triggeredIds: ['stop-api']});
  const result = await checkRecoveryAction(session, {
    env: {},
    evaluateCondition: async (_env, _sessionId, condition) =>
      condition.type !== 'process_running',
  });

  assert.equal(result.declarable, true);
  assert.equal(result.allOk, false);
  assert.deepEqual(
    result.checks.map((check) => ({type: check.condition.type, ok: check.ok})),
    [
      {type: 'http_status', ok: true},
      {type: 'process_running', ok: false},
    ]
  );
});
