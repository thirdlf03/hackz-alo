import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  describeVoiceStatus,
  FALLBACK_ICE_SERVERS,
  isPolitePeer,
  parseIceServers,
  parseRtcSignal,
  shouldHandleSignal,
} = await tsImport('../../apps/web/src/pure/voiceChat.ts', import.meta.url);

test('parseRtcSignal accepts valid signals and rejects malformed ones', () => {
  assert.deepEqual(parseRtcSignal({fromParticipantId: 'a', kind: 'join'}), {
    fromParticipantId: 'a',
    kind: 'join',
  });
  const offer = parseRtcSignal({
    fromParticipantId: 'a',
    toParticipantId: 'b',
    kind: 'offer',
    payload: {type: 'offer', sdp: 'v=0'},
  });
  assert.equal(offer.toParticipantId, 'b');
  assert.deepEqual(offer.payload, {type: 'offer', sdp: 'v=0'});
  assert.equal(parseRtcSignal({kind: 'offer'}), undefined);
  assert.equal(
    parseRtcSignal({fromParticipantId: 'a', kind: 'unknown'}),
    undefined
  );
  assert.equal(parseRtcSignal(null), undefined);
});

test('shouldHandleSignal filters own and misaddressed messages', () => {
  const broadcast = {fromParticipantId: 'a', kind: 'join'};
  assert.equal(shouldHandleSignal(broadcast, 'a'), false);
  assert.equal(shouldHandleSignal(broadcast, 'b'), true);
  const directed = {fromParticipantId: 'a', toParticipantId: 'b', kind: 'ice'};
  assert.equal(shouldHandleSignal(directed, 'b'), true);
  assert.equal(shouldHandleSignal(directed, 'c'), false);
});

test('isPolitePeer is asymmetric and deterministic', () => {
  assert.notEqual(isPolitePeer('a', 'b'), isPolitePeer('b', 'a'));
  assert.equal(isPolitePeer('a', 'b'), isPolitePeer('a', 'b'));
});

test('parseIceServers falls back to STUN on malformed data', () => {
  assert.deepEqual(parseIceServers(undefined), FALLBACK_ICE_SERVERS);
  assert.deepEqual(parseIceServers({iceServers: 'x'}), FALLBACK_ICE_SERVERS);
  assert.deepEqual(parseIceServers({iceServers: []}), FALLBACK_ICE_SERVERS);
  const servers = parseIceServers({
    iceServers: [
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'u',
        credential: 'c',
      },
      {bogus: true},
    ],
  });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].username, 'u');
});

test('describeVoiceStatus covers all states', () => {
  for (const status of [
    'idle',
    'requesting_mic',
    'connecting',
    'connected',
    'mic_denied',
    'error',
  ]) {
    assert.equal(typeof describeVoiceStatus(status, 0, false), 'string');
  }
  assert.ok(describeVoiceStatus('connected', 2, false).includes('2'));
  assert.ok(describeVoiceStatus('connected', 2, true).includes('ミュート'));
});
