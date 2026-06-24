import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {decideReplayReadPolicy, normalizeReplayVisibility} = await tsImport(
  '../../apps/worker/src/pure/replayReadPolicy.ts',
  import.meta.url
);

test('replay read policy allows public replay reads without private events', () => {
  assert.deepEqual(decideReplayReadPolicy('public'), {
    allowed: true,
    includePrivateEvents: false,
    reason: 'public',
  });
});

test('replay read policy requires a credential for private and unlisted replays', () => {
  assert.deepEqual(decideReplayReadPolicy('private'), {
    allowed: false,
    includePrivateEvents: false,
    reason: 'token_required',
    status: 401,
  });
  assert.deepEqual(decideReplayReadPolicy('unlisted'), {
    allowed: false,
    includePrivateEvents: false,
    reason: 'token_required',
    status: 401,
  });
});

test('replay read policy allows write or read token holders to see full event index', () => {
  assert.deepEqual(decideReplayReadPolicy('private', {hasWriteToken: true}), {
    allowed: true,
    includePrivateEvents: true,
    reason: 'token',
  });
  assert.deepEqual(decideReplayReadPolicy('unlisted', {hasReadToken: true}), {
    allowed: true,
    includePrivateEvents: true,
    reason: 'token',
  });
  assert.deepEqual(decideReplayReadPolicy('public', {hasReadToken: true}), {
    allowed: true,
    includePrivateEvents: true,
    reason: 'token',
  });
});

test('replay read policy treats legacy or missing visibility as private', () => {
  assert.equal(normalizeReplayVisibility('self'), 'private');
  assert.equal(normalizeReplayVisibility('team'), 'private');
  assert.equal(normalizeReplayVisibility(undefined), 'private');
});
