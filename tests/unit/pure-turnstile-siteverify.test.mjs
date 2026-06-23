import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildTurnstileSiteverifyBody,
  readTurnstileSiteverifyErrorCodes,
  readTurnstileSiteverifySuccess,
} = await tsImport(
  '../../apps/worker/src/pure/turnstileSiteverify.ts',
  import.meta.url
);

test('buildTurnstileSiteverifyBody omits remoteip', () => {
  const body = buildTurnstileSiteverifyBody('secret', 'token', 'idem-1');
  assert.equal(body.get('secret'), 'secret');
  assert.equal(body.get('response'), 'token');
  assert.equal(body.get('idempotency_key'), 'idem-1');
  assert.equal(body.get('remoteip'), null);
});

test('readTurnstileSiteverifySuccess accepts success payloads', () => {
  assert.equal(readTurnstileSiteverifySuccess({success: true}), true);
  assert.equal(readTurnstileSiteverifySuccess({success: false}), false);
});

test('readTurnstileSiteverifyErrorCodes extracts string codes', () => {
  assert.deepEqual(
    readTurnstileSiteverifyErrorCodes({
      success: false,
      'error-codes': ['timeout-or-duplicate', 1],
    }),
    ['timeout-or-duplicate']
  );
});
