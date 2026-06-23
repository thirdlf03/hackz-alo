import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {appendEdgeRttHistory, roundSessionEdgeRtt} = await tsImport(
  '../../apps/web/src/pure/sessionEdgeRtt.ts',
  import.meta.url
);

test('appendEdgeRttHistory keeps the latest samples', () => {
  const history = appendEdgeRttHistory([10, 20], 30, 3);
  assert.deepEqual(history, [10, 20, 30]);
  assert.deepEqual(appendEdgeRttHistory([1, 2, 3], 4, 3), [2, 3, 4]);
});

test('roundSessionEdgeRtt never returns negative values', () => {
  assert.equal(roundSessionEdgeRtt(42.6), 43);
  assert.equal(roundSessionEdgeRtt(-1), 0);
});
