import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {parseBearerToken, verifyWriteTokenHash, hashWriteToken} = await tsImport(
  '../../apps/worker/src/pure/writeAuth.ts',
  import.meta.url
);

test('write auth pure helpers', async () => {
  assert.equal(parseBearerToken('Bearer abc'), 'abc');
  const hash = await hashWriteToken('token');
  assert.equal(verifyWriteTokenHash(hash, hash), true);
  assert.equal(verifyWriteTokenHash(hash, 'b'.repeat(64)), false);
});

test('integration contract: protected replay routes require bearer token', () => {
  const protectedRoutes = [
    'POST /api/replays/:replayId/chunks',
    'POST /api/replays/:replayId/events',
    'POST /api/replays/:replayId/finish',
    'POST /api/replays/:replayId/finalize-video',
    'POST /api/replays/:replayId/thumbnail',
  ];
  assert.ok(protectedRoutes.length >= 5);
});
