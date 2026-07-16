import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  buildParticipantGuardPingMessage,
  buildParticipantGuardPongMessage,
  isParticipantGuardPingMessage,
  isParticipantGuardPongMessage,
  participantGuardChannelName,
} from '../../apps/web/src/pure/participantIdentityGuard.ts';

test('participantGuardChannelName is derived from the participantId', () => {
  const name = participantGuardChannelName('part_abc123');
  assert.equal(name, 'incident-participant-guard:part_abc123');
  // Same participantId (e.g. a duplicated tab) always computes the same
  // channel name, letting both tabs find each other.
  assert.equal(name, participantGuardChannelName('part_abc123'));
});

test('participantGuardChannelName differs for different participantIds', () => {
  assert.notEqual(
    participantGuardChannelName('part_a'),
    participantGuardChannelName('part_b')
  );
});

test('ping/pong message builders round-trip through the type guards', () => {
  const ping = buildParticipantGuardPingMessage('req_1');
  assert.deepEqual(ping, {type: 'ping', requestId: 'req_1'});
  assert.equal(isParticipantGuardPingMessage(ping), true);
  assert.equal(isParticipantGuardPongMessage(ping), false);

  const pong = buildParticipantGuardPongMessage('req_1');
  assert.deepEqual(pong, {type: 'pong', requestId: 'req_1'});
  assert.equal(isParticipantGuardPongMessage(pong), true);
  assert.equal(isParticipantGuardPingMessage(pong), false);
});

test('type guards reject malformed or unrelated messages', () => {
  assert.equal(isParticipantGuardPingMessage(undefined), false);
  assert.equal(isParticipantGuardPingMessage(null), false);
  assert.equal(isParticipantGuardPingMessage('ping'), false);
  assert.equal(isParticipantGuardPingMessage({type: 'ping'}), false);
  assert.equal(
    isParticipantGuardPingMessage({type: 'ping', requestId: 42}),
    false
  );
  assert.equal(
    isParticipantGuardPongMessage({type: 'ping', requestId: 'req_1'}),
    false
  );
});
