import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {SessionSseHub} = await tsImport(
  '../../apps/worker/src/durable/sessionSseHub.ts',
  import.meta.url
);

test('SessionSseHub sends snapshot, buffered replay, broadcasts, and cleans clients', async () => {
  let closeCount = 0;
  let touchCount = 0;
  const hub = new SessionSseHub({
    loadSnapshot: async () => ({sessionId: 'sess_1'}),
    loadReplayBuffer: async () => [{id: 'evt_buffered'}],
    touchClientActivity: async () => {
      touchCount += 1;
    },
    onClientClose: async () => {
      closeCount += 1;
    },
  });

  const response = hub.response(new Request('http://test/events'));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(hub.size, 1);

  const reader = response.body.getReader();
  assert.match(await readSseChunk(reader), /event: snapshot/);
  assert.match(await readSseChunk(reader), /evt_buffered/);
  assert.equal(hub.size, 1);
  assert.equal(touchCount, 1);

  hub.broadcast('replay', {id: 'evt_live'});
  assert.match(await readSseChunk(reader), /evt_live/);

  await reader.cancel();
  assert.equal(hub.size, 0);
  assert.equal(closeCount, 1);
});

async function readSseChunk(reader) {
  const result = await reader.read();
  assert.equal(result.done, false);
  return new TextDecoder().decode(result.value);
}
