import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {measureSessionEdgeRtt} = await tsImport(
  '../../apps/web/src/effect/sessionEdgeRtt.ts',
  import.meta.url
);

test('measureSessionEdgeRtt measures async request duration', async () => {
  const rttMs = await measureSessionEdgeRtt(async () => {
    await new Promise((resolve) => setTimeout(resolve, 12));
  });
  assert.ok(rttMs >= 10);
});
