import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {decideSessionReadPolicy} = await tsImport(
  '../../apps/worker/src/pure/sessionReadPolicy.ts',
  import.meta.url
);

test('session read policy rejects missing credentials', () => {
  assert.deepEqual(decideSessionReadPolicy({}), {
    allowed: false,
    reason: 'token_required',
    status: 401,
  });
});

test('session read policy accepts write or read credentials', () => {
  assert.deepEqual(decideSessionReadPolicy({hasWriteToken: true}), {
    allowed: true,
    reason: 'token',
  });
  assert.deepEqual(decideSessionReadPolicy({hasReadToken: true}), {
    allowed: true,
    reason: 'token',
  });
});
