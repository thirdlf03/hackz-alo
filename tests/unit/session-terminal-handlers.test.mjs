import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {parseTerminalResize, mergeTerminalResize} = await tsImport(
  '../../apps/worker/src/pure/sessionTerminalResize.ts',
  import.meta.url
);

test('parseTerminalResize clamps terminal dimensions to supported bounds', () => {
  assert.deepEqual(parseTerminalResize({cols: 10, rows: 5}), {
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(parseTerminalResize({cols: 120, rows: 30}), {
    cols: 120,
    rows: 30,
  });
  assert.deepEqual(parseTerminalResize({cols: 999, rows: 999}), {
    cols: 80,
    rows: 24,
  });
});

test('mergeTerminalResize updates only provided dimensions', () => {
  assert.deepEqual(mergeTerminalResize({cols: 100, rows: 30}, {cols: 120}), {
    cols: 120,
    rows: 30,
  });
  assert.deepEqual(mergeTerminalResize({cols: 100, rows: 30}, {rows: 40}), {
    cols: 100,
    rows: 40,
  });
});
