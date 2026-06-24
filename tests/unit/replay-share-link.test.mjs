import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildReplaySharePath,
  DEFAULT_SHARE_LINK_TTL_HOURS,
  MAX_SHARE_LINK_TTL_HOURS,
  normalizeShareLinkTtlHours,
  replayVisibilityAfterShare,
  shareLinkExpiresAt,
  ShareLinkTtlError,
} = await tsImport(
  '../../apps/worker/src/pure/replayShareLink.ts',
  import.meta.url
);

test('normalizeShareLinkTtlHours defaults and validates bounds', () => {
  assert.equal(
    normalizeShareLinkTtlHours(undefined),
    DEFAULT_SHARE_LINK_TTL_HOURS
  );
  assert.equal(normalizeShareLinkTtlHours(24), 24);
  assert.throws(
    () => normalizeShareLinkTtlHours(0),
    (error) => error instanceof ShareLinkTtlError
  );
  assert.throws(
    () => normalizeShareLinkTtlHours(MAX_SHARE_LINK_TTL_HOURS + 1),
    (error) => error instanceof ShareLinkTtlError
  );
});

test('shareLinkExpiresAt and buildReplaySharePath encode replay access', () => {
  const expiresAt = shareLinkExpiresAt(
    Date.parse('2026-06-01T00:00:00.000Z'),
    24
  );
  assert.equal(expiresAt, '2026-06-02T00:00:00.000Z');
  assert.equal(
    buildReplaySharePath('repl_test', 'reader-token'),
    '/?replay=repl_test&readToken=reader-token'
  );
});

test('replayVisibilityAfterShare keeps public replays public', () => {
  assert.equal(replayVisibilityAfterShare('private'), 'unlisted');
  assert.equal(replayVisibilityAfterShare('unlisted'), 'unlisted');
  assert.equal(replayVisibilityAfterShare('public'), 'public');
});
