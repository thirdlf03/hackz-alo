import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  assertReplayId,
  replayChunkKey,
  replayEventsKey,
  replayEventsManifestKey,
  replayThumbnailKey,
  replayVideoKey,
} from '../../packages/shared/src/r2Keys.ts';

const replayId = 'repl_0123456789abcdef';

test('replay R2 keys are stable and scoped under replay id', () => {
  assert.equal(assertReplayId(replayId), replayId);
  assert.equal(
    replayVideoKey(replayId),
    'replays/repl_0123456789abcdef/video.webm'
  );
  assert.equal(
    replayChunkKey(replayId, 0),
    'replays/repl_0123456789abcdef/chunks/000000.webm'
  );
  assert.equal(
    replayChunkKey(replayId, 42),
    'replays/repl_0123456789abcdef/chunks/000042.webm'
  );
  assert.equal(
    replayEventsKey(replayId, 7),
    'replays/repl_0123456789abcdef/events/000007.jsonl'
  );
  assert.equal(
    replayEventsManifestKey(replayId),
    'replays/repl_0123456789abcdef/events-manifest.json'
  );
  assert.equal(
    replayThumbnailKey(replayId),
    'replays/repl_0123456789abcdef/thumbnail.webp'
  );
});

test('replay id validation rejects path traversal and non-string input', () => {
  for (const invalid of [
    '',
    'short',
    '../secret',
    'abc/def',
    'abc.def',
    'a'.repeat(81),
    123456,
    undefined,
  ]) {
    assert.throws(
      () => assertReplayId(invalid),
      /invalid replayId/,
      `expected ${String(invalid)} to be invalid`
    );
  }
});

test('replay chunk and event keys reject invalid sequence numbers', () => {
  for (const invalid of [-1, 1.5, 1000000, '1', Number.NaN]) {
    assert.throws(
      () => replayChunkKey(replayId, invalid),
      /invalid sequence number/
    );
    assert.throws(
      () => replayEventsKey(replayId, invalid),
      /invalid sequence number/
    );
  }
});
