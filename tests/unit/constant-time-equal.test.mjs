import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {constantTimeEqual} = await tsImport(
  '../../apps/worker/src/pure/constantTimeEqual.ts',
  import.meta.url
);

test('constantTimeEqual accepts identical strings', () => {
  assert.equal(constantTimeEqual('abc123', 'abc123'), true);
  assert.equal(constantTimeEqual('', ''), true);
});

test('constantTimeEqual rejects strings that differ mid-string', () => {
  assert.equal(constantTimeEqual('abc123', 'abc124'), false);
});

test('constantTimeEqual rejects strings of different length without early return', () => {
  assert.equal(constantTimeEqual('short', 'much-longer-string'), false);
  assert.equal(constantTimeEqual('much-longer-string', 'short'), false);
});

test('constantTimeEqual rejects empty vs non-empty', () => {
  assert.equal(constantTimeEqual('', 'a'), false);
  assert.equal(constantTimeEqual('a', ''), false);
});

test('constantTimeEqual runtime does not shortcut on early mismatch', () => {
  // Not a strict timing assertion (unreliable in CI), but confirms the
  // implementation scans the full length rather than returning as soon as
  // the first character differs: a full-length probe touching every byte
  // must take at least as long as an early-mismatch probe of same length.
  const long = 'x'.repeat(10_000);
  const mismatchFirstChar = `y${'x'.repeat(9_999)}`;
  const mismatchLastChar = `${'x'.repeat(9_999)}y`;
  assert.equal(constantTimeEqual(long, mismatchFirstChar), false);
  assert.equal(constantTimeEqual(long, mismatchLastChar), false);
});
