import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {parseBearerToken, verifyWriteTokenHash, hashWriteToken} = await tsImport(
  '../../apps/worker/src/pure/writeAuth.ts',
  import.meta.url
);

test('parseBearerToken extracts bearer credentials', () => {
  assert.equal(parseBearerToken(undefined), undefined);
  assert.equal(parseBearerToken('Basic abc'), undefined);
  assert.equal(parseBearerToken('Bearer token-123'), 'token-123');
});

test('verifyWriteTokenHash compares sha256 digests', () => {
  assert.equal(verifyWriteTokenHash('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(verifyWriteTokenHash('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(verifyWriteTokenHash('short', 'short'), false);
});

test('hashWriteToken returns stable sha256 hex', async () => {
  const hash = await hashWriteToken('secret-token');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashWriteToken('secret-token'), hash);
});
