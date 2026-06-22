import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {getSessionDoStub} = await tsImport(
  '../../apps/worker/src/effect/sessionDoStub.ts',
  import.meta.url
);

test('getSessionDoStub pins session DO creation to apac-ne', () => {
  const calls = [];
  const namespace = {
    idFromName(name) {
      return {name};
    },
    get(id, options) {
      calls.push({id, options});
      return {fetch: async () => new Response('ok')};
    },
  };

  const stub = getSessionDoStub(namespace, 'sess_test');
  assert.equal(typeof stub.fetch, 'function');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.id.name, 'sess_test');
  assert.equal(calls[0]?.options?.locationHint, 'apac-ne');
});
