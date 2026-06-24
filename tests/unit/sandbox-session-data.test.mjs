import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {isAllowedSessionLogFile, clampSessionLogTail} = await tsImport(
  '../../apps/worker/src/pure/sessionLogPolicy.ts',
  import.meta.url
);

test('isAllowedSessionLogFile accepts sandbox log channels only', () => {
  assert.equal(isAllowedSessionLogFile('access'), true);
  assert.equal(isAllowedSessionLogFile('app'), true);
  assert.equal(isAllowedSessionLogFile('batch'), true);
  assert.equal(isAllowedSessionLogFile('debug'), false);
  assert.equal(isAllowedSessionLogFile(''), false);
});

test('clampSessionLogTail defaults invalid values and caps at 200', () => {
  assert.equal(clampSessionLogTail(Number.NaN), 50);
  assert.equal(clampSessionLogTail(0), 1);
  assert.equal(clampSessionLogTail(999), 200);
  assert.equal(clampSessionLogTail(25), 25);
});
