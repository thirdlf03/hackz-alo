import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {ReplayEventValidationError, validateReplayEventBatch} = await tsImport(
  '../../apps/worker/src/pure/replayEventValidation.ts',
  import.meta.url
);

test('validateReplayEventBatch accepts valid events and normalizes route replay id and time', () => {
  const events = validateReplayEventBatch('repl_1', [
    {
      id: 'evt_1',
      replayId: 'repl_1',
      type: 'terminal_input',
      at: 12.8,
      actor: 'player',
      payload: {data: 'curl /health'},
      visibility: 'private',
    },
  ]);

  assert.deepEqual(events, [
    {
      id: 'evt_1',
      replayId: 'repl_1',
      type: 'terminal_input',
      at: 12,
      actor: 'player',
      payload: {data: 'curl /health'},
      visibility: 'private',
    },
  ]);
});

test('validateReplayEventBatch rejects unknown type actor visibility and payload shape', () => {
  const base = {
    id: 'evt_1',
    type: 'terminal_input',
    at: 0,
    actor: 'player',
    payload: {},
    visibility: 'public_safe',
  };
  assertValidationError([{...base, type: 'unknown'}], /unknown event type/);
  assertValidationError([{...base, actor: 'unknown'}], /unknown event actor/);
  assertValidationError(
    [{...base, visibility: 'unknown'}],
    /unknown event visibility/
  );
  assertValidationError([{...base, payload: []}], /payload must be an object/);
});

test('validateReplayEventBatch rejects mismatched replay id and oversized payload', () => {
  const base = {
    id: 'evt_1',
    type: 'terminal_input',
    at: 0,
    actor: 'player',
    payload: {},
    visibility: 'public_safe',
  };
  assertValidationError(
    [{...base, replayId: 'repl_other'}],
    /replayId does not match route/
  );
  assertValidationError(
    [{...base, payload: {data: 'x'.repeat(9 * 1024)}}],
    /payload is too large/
  );
});

function assertValidationError(events, pattern) {
  assert.throws(
    () => validateReplayEventBatch('repl_1', events),
    (error) => {
      assert.equal(error instanceof ReplayEventValidationError, true);
      assert.match(error.message, pattern);
      return true;
    }
  );
}
