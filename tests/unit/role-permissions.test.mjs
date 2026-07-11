import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  canOperateSandbox,
  canContributeRecords,
  resolveTerminalCanOperate,
} from '../../apps/web/src/pure/rolePermissions.ts';

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

test('canOperateSandbox allows solo play regardless of role', () => {
  const participants = [participant('observer')];
  assert.equal(canOperateSandbox(participants, 'observer_1'), true);
});

test('canOperateSandbox allows ops and facilitator in multiplayer, rejects others', () => {
  const participants = [
    participant('ops'),
    participant('facilitator'),
    participant('incident_commander'),
    participant('observer'),
  ];
  assert.equal(canOperateSandbox(participants, 'ops_1'), true);
  assert.equal(canOperateSandbox(participants, 'facilitator_1'), true);
  assert.equal(canOperateSandbox(participants, 'incident_commander_1'), false);
  assert.equal(canOperateSandbox(participants, 'observer_1'), false);
});

test('canContributeRecords rejects only observers in multiplayer', () => {
  const participants = [participant('scribe'), participant('observer')];
  assert.equal(canContributeRecords(participants, 'scribe_1'), true);
  assert.equal(canContributeRecords(participants, 'observer_1'), false);
});

test('resolveTerminalCanOperate prefers the live participants list when present', () => {
  const attachTimeParticipants = [participant('ops'), participant('observer')];
  const liveParticipants = [
    participant('ops'),
    participant('observer', {role: 'ops', participantId: 'observer_1'}),
  ];
  // At attach time, observer_1 could not operate; the live room state now
  // has them promoted to ops, and the live source should win.
  assert.equal(
    resolveTerminalCanOperate(
      attachTimeParticipants,
      attachTimeParticipants,
      'observer_1'
    ),
    false
  );
  assert.equal(
    resolveTerminalCanOperate(
      liveParticipants,
      attachTimeParticipants,
      'observer_1'
    ),
    true
  );
});

test('resolveTerminalCanOperate falls back to the attach-time snapshot when no live source exists yet', () => {
  const attachTimeParticipants = [participant('ops'), participant('observer')];
  // gameStateRef.current is still undefined this early (before play has
  // started), so `liveParticipants` is undefined and the attach-time
  // snapshot from exerciseSnapshot must be used instead.
  assert.equal(
    resolveTerminalCanOperate(undefined, attachTimeParticipants, 'observer_1'),
    false
  );
  assert.equal(
    resolveTerminalCanOperate(undefined, attachTimeParticipants, 'ops_1'),
    true
  );
});
