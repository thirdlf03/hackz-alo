import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canDeclareRecovery} from '../../packages/shared/src/recovery.ts';

test('canDeclareRecovery blocks recovery before any scenario trigger fires', () => {
  const scenario = {
    triggers: [
      {
        id: 'stop-api',
        atMs: 60000,
        type: 'process_stop',
        params: {processId: 'api'},
      },
    ],
  };
  assert.equal(canDeclareRecovery(scenario, []), false);
  assert.equal(canDeclareRecovery(scenario, ['stop-api']), true);
});

test('canDeclareRecovery requires every trigger on multi-trigger scenarios', () => {
  const scenario = {
    triggers: [
      {id: 'spam', atMs: 45000, type: 'alert_spam', params: {count: 32}},
      {
        id: 'real-stop',
        atMs: 120000,
        type: 'process_stop',
        params: {processId: 'api'},
      },
    ],
  };
  assert.equal(canDeclareRecovery(scenario, []), false);
  assert.equal(canDeclareRecovery(scenario, ['spam']), false);
  assert.equal(canDeclareRecovery(scenario, ['spam', 'real-stop']), true);
});

test('canDeclareRecovery allows recovery when scenario has no triggers', () => {
  assert.equal(canDeclareRecovery({triggers: []}, []), true);
});
