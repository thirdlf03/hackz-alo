import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  ROLE_INFO,
  roleInfoFor,
  roleInfoList,
} from '../../apps/web/src/pure/roleInfo.ts';
import {canOperateSandbox} from '../../apps/web/src/pure/rolePermissions.ts';

// Mirrors packages/shared/src/types.ts PARTICIPANT_ROLES. Not imported
// directly: types.ts re-exports a runtime binding from replayVisibility.js
// via a `.js`-suffixed specifier that only a bundler (vite/esbuild)
// resolves to the sibling `.ts` file — plain `node --test` (native TS type
// stripping, no bundler) fails to resolve it. role-permissions.test.mjs
// works around the same constraint by using literal role strings instead
// of importing PARTICIPANT_ROLES; this test follows that convention.
const PARTICIPANT_ROLES = [
  'incident_commander',
  'ops',
  'scribe',
  'comms',
  'facilitator',
  'observer',
];

function participant(role, overrides = {}) {
  return {
    participantId: overrides.participantId ?? `${role}_1`,
    displayName: role,
    role,
    ready: true,
    online: overrides.online ?? true,
    joinedAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('ROLE_INFO defines an entry for every PARTICIPANT_ROLES value', () => {
  for (const role of PARTICIPANT_ROLES) {
    const info = ROLE_INFO[role];
    assert.ok(info, `missing RoleInfo for ${role}`);
    assert.equal(info.role, role);
    assert.ok(info.label.length > 0);
    assert.ok(info.tagline.length > 0);
    assert.ok(Array.isArray(info.can));
    assert.ok(Array.isArray(info.cannot));
  }
});

test('roleInfoFor returns the matching entry and roleInfoList covers all roles', () => {
  for (const role of PARTICIPANT_ROLES) {
    assert.equal(roleInfoFor(role), ROLE_INFO[role]);
  }
  assert.equal(roleInfoList.length, PARTICIPANT_ROLES.length);
});

test('canOperateTerminal is true only for ops and facilitator', () => {
  for (const role of PARTICIPANT_ROLES) {
    const expected = role === 'ops' || role === 'facilitator';
    assert.equal(
      ROLE_INFO[role].canOperateTerminal,
      expected,
      `unexpected canOperateTerminal for ${role}`
    );
  }
});

test('ROLE_INFO.canOperateTerminal matches rolePermissions.canOperateSandbox in multiplayer', () => {
  // Multiplayer room (>1 online) so the solo-play rescue in
  // canOperateSandbox does not mask the per-role gate.
  const participants = PARTICIPANT_ROLES.map((role) => participant(role));
  for (const role of PARTICIPANT_ROLES) {
    const participantId = `${role}_1`;
    assert.equal(
      ROLE_INFO[role].canOperateTerminal,
      canOperateSandbox(participants, participantId),
      `mismatch between roleInfo and canOperateSandbox for ${role}`
    );
  }
});
