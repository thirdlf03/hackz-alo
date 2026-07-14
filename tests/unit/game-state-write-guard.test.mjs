import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {createGameStateWriteGuard} = await tsImport(
  '../../apps/web/src/pure/gameStateWriteGuard.ts',
  import.meta.url
);

test('shouldApply is true for an untagged state (call sites that never call tag)', () => {
  const guard = createGameStateWriteGuard();
  assert.equal(guard.shouldApply({}), true);
});

test('shouldApply is true for the most recently tagged state', () => {
  const guard = createGameStateWriteGuard();
  const a = {label: 'a'};
  const b = {label: 'b'};
  guard.tag(a);
  guard.tag(b);
  assert.equal(guard.shouldApply(b), true);
});

test('shouldApply is false once a newer state has been tagged, even if applied later (out-of-order effect flush)', () => {
  const guard = createGameStateWriteGuard();
  const older = {label: 'older'};
  const newer = {label: 'newer'};

  // Simulates a direct ref write (e.g. patchGameStateRef / the game loop
  // tick) tagging `older`, then — before the React effect mirroring
  // `older` back into the ref gets a chance to run — another direct
  // write tags `newer`. See gameStateWriteGuard.ts for the underlying
  // race (PR3 retire-confirm / editor-file e2e flake).
  guard.tag(older);
  guard.tag(newer);

  assert.equal(guard.shouldApply(older), false);
  assert.equal(guard.shouldApply(newer), true);
});

test('tag returns the same state object it was given', () => {
  const guard = createGameStateWriteGuard();
  const state = {label: 'x'};
  assert.equal(guard.tag(state), state);
});

test('a state tagged exactly once and never superseded stays applicable across repeated checks', () => {
  const guard = createGameStateWriteGuard();
  const state = {label: 'only'};
  guard.tag(state);
  assert.equal(guard.shouldApply(state), true);
  assert.equal(guard.shouldApply(state), true);
});
