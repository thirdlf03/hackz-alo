import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  cloudflareTurnEndpoint,
  FALLBACK_ICE_SERVERS,
  parseRtcSignalBody,
  parseTurnResponse,
} = await tsImport(
  '../../apps/worker/src/pure/turnCredentials.ts',
  import.meta.url
);

test('cloudflareTurnEndpoint targets the Calls TURN API', () => {
  assert.equal(
    cloudflareTurnEndpoint('key1'),
    'https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers'
  );
  assert.ok(cloudflareTurnEndpoint('a/b').includes('a%2Fb'));
});

test('parseTurnResponse accepts iceServers arrays and single objects', () => {
  const array = parseTurnResponse({
    iceServers: [
      {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
        ],
        username: 'u',
        credential: 'c',
      },
    ],
  });
  assert.equal(array.length, 1);
  const single = parseTurnResponse({
    iceServers: {urls: 'stun:stun.cloudflare.com:3478'},
  });
  assert.equal(single.length, 1);
});

test('parseTurnResponse rejects malformed bodies', () => {
  assert.equal(parseTurnResponse(undefined), undefined);
  assert.equal(parseTurnResponse({}), undefined);
  assert.equal(parseTurnResponse({iceServers: [{}]}), undefined);
});

test('FALLBACK_ICE_SERVERS is STUN-only', () => {
  assert.ok(FALLBACK_ICE_SERVERS.length > 0);
  for (const server of FALLBACK_ICE_SERVERS) {
    assert.ok(String(server.urls).startsWith('stun:'));
    assert.equal(server.credential, undefined);
  }
});

test('parseRtcSignalBody validates kinds and participant ids', () => {
  const valid = parseRtcSignalBody({
    fromParticipantId: 'part_a',
    toParticipantId: 'part_b',
    kind: 'offer',
    payload: {type: 'offer', sdp: 'v=0'},
  });
  assert.equal(valid.kind, 'offer');
  assert.equal(parseRtcSignalBody({kind: 'offer'}), undefined);
  assert.equal(
    parseRtcSignalBody({fromParticipantId: 'a', kind: 'nope'}),
    undefined
  );
  assert.equal(
    parseRtcSignalBody({fromParticipantId: 'a'.repeat(101), kind: 'ice'}),
    undefined
  );
  const broadcast = parseRtcSignalBody({fromParticipantId: 'a', kind: 'join'});
  assert.equal(broadcast.toParticipantId, undefined);
});
