import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {ScenarioApi} = await tsImport(
  '../../apps/web/src/api/scenarioApi.ts',
  import.meta.url
);
const {SessionApi} = await tsImport(
  '../../apps/web/src/api/sessionApi.ts',
  import.meta.url
);
const {ReplayApi, RecordingUploadApi} = await tsImport(
  '../../apps/web/src/api/replayApi.ts',
  import.meta.url
);

function mockHttp() {
  const calls = [];
  const http = {
    calls,
    get: async (path) => {
      calls.push({method: 'GET', path});
      if (path.endsWith('/chunks'))
        return [{seq: 1, object_key: 'k1', byte_size: 3}];
      if (path.includes('/events'))
        return [{event_id: 'e1', type: 'play', at_ms: 1}];
      if (path.includes('/comments'))
        return [{id: 'c1', at_ms: 1, body: 'x', created_at: 't'}];
      if (path.includes('/featured')) return [{id: 'r1', created_at: 't'}];
      return {id: 'replay-1'};
    },
    post: async (path, body) => {
      calls.push({method: 'POST', path, body});
      return {ok: true, uploadId: 'up-1', key: 'k1'};
    },
    put: async (path, body) => {
      calls.push({method: 'PUT', path, body});
      return {path: '/workspace/app.un', byteLength: 3};
    },
    request: async (path, init) => {
      calls.push({method: init.method, path, body: init.body});
    },
    fetch: async (path) => {
      calls.push({method: 'FETCH', path});
      if (path.includes('/chunks/404')) {
        return new Response('nope', {status: 404});
      }
      return new Response(new Blob(['vid'], {type: 'video/webm'}), {
        status: 200,
      });
    },
  };
  return http;
}

test('ScenarioApi and SessionApi build expected routes', async () => {
  const http = mockHttp();
  const scenarios = new ScenarioApi(http);
  const sessions = new SessionApi(http);

  await scenarios.listScenarios();
  await scenarios.getScenario('demo/tutorial');
  await sessions.prepareSession('session-id');
  await sessions.startSession('session-id');
  await sessions.readSessionFile('session-1', '/workspace/app.un');
  await sessions.writeSessionFile('session-1', '/workspace/app.un', 'うん');

  assert.deepEqual(http.calls[0], {method: 'GET', path: '/api/scenarios'});
  assert.equal(http.calls[1]?.path, '/api/scenarios/demo%2Ftutorial');
  assert.equal(http.calls[2]?.path, '/api/sessions/session-id/prepare');
  assert.equal(http.calls[3]?.path, '/api/sessions/session-id/start');
  assert.match(http.calls[4]?.path, /file\?path=%2Fworkspace%2Fapp\.un$/);
  assert.equal(http.calls[5]?.path, '/api/sessions/session-1/file');
});

test('SessionApi covers session lifecycle, editor routes, and SSE handlers', async () => {
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    emit(type, payload) {
      const listener = this.listeners[type];
      if (listener) listener({data: JSON.stringify(payload)});
    }
  }
  globalThis.EventSource = MockEventSource;

  const beacons = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      sendBeacon: (url, body) => {
        beacons.push({url, body});
        return true;
      },
    },
    configurable: true,
    writable: true,
  });
  globalThis.fetch = async () => new Response('{}');

  const http = mockHttp();
  const sessions = new SessionApi(http);
  let snapshot;
  let replay;
  let errorSeen = false;
  const source = sessions.subscribeSessionEvents('session-1', {
    onSnapshot: (value) => {
      snapshot = value;
    },
    onReplay: (value) => {
      replay = value;
    },
    onError: () => {
      errorSeen = true;
    },
  });
  assert.equal(source.url, '/api/sessions/session-1/events');
  source.emit('snapshot', {sessionId: 'session-1', gameTimeMs: 1});
  source.emit('replay', {eventId: 'e1', type: 'play', atMs: 1});
  source.emit('error', {});
  assert.equal(snapshot?.sessionId, 'session-1');
  assert.equal(replay?.eventId, 'e1');
  assert.equal(errorSeen, true);

  await sessions.createSession({scenarioId: 'demo'});
  await sessions.deleteSession('session-1');
  await sessions.getSessionClock('session-1');
  await sessions.updateSessionClock('session-1', 2);
  await sessions.getSessionMetrics('session-1');
  await sessions.getSessionLogs('session-1', 'access', 10);
  await sessions.getSessionStorage('session-1');
  await sessions.listSessionFiles('session-1');
  await sessions.resizeTerminal('session-1', 120, 40);
  await sessions.interruptTerminal('session-1');
  await sessions.resolveSession('session-1');
  await sessions.retireSession('session-1');
  await sessions.timeoutSession('session-1');
  sessions.notifySessionTimeout('session-1');

  assert.equal(beacons.length, 1);
  assert.match(beacons[0]?.url ?? '', /timeout$/);
  assert.match(
    http.calls.find((call) => call.path.includes('/clock'))?.path ?? '',
    /clock$/
  );
  assert.match(
    http.calls.find((call) => call.path.includes('/logs'))?.path ?? '',
    /logs\?/
  );
  assert.match(
    http.calls.find((call) => call.path.includes('/terminal/resize'))?.path ??
      '',
    /resize$/
  );
});

test('SessionApi notifySessionTimeout falls back to fetch when sendBeacon is unavailable', async () => {
  const posts = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
    writable: true,
  });
  globalThis.fetch = async (url, init) => {
    posts.push({url, init});
    return new Response('{}');
  };

  const sessions = new SessionApi(mockHttp());
  sessions.notifySessionTimeout('session-2');

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.init?.method, 'POST');
  assert.match(String(posts[0]?.url), /timeout$/);
});

test('ReplayApi waits for server video instead of client-side chunk merge', async () => {
  const http = mockHttp();
  const replays = new ReplayApi(http);

  const url = await replays.waitForReplayVideo('replay-1', 1000);
  assert.equal(url, '/api/replays/replay-1/video');
  assert.equal(http.calls.filter((call) => call.method === 'FETCH').length, 1);

  await replays.finishReplay('replay-1', {videoDurationMs: 1200});
  await replays.addReplayComment('replay-1', 1000, 'nice save');
  assert.match(http.calls.at(-2)?.path ?? '', /finish$/);
  assert.match(http.calls.at(-1)?.path ?? '', /comments$/);
});

test('ReplayApi covers replay metadata, chunks, and upload helpers', async () => {
  const http = mockHttp();
  const replays = new ReplayApi(http);
  const upload = new RecordingUploadApi(http);
  globalThis.URL.createObjectURL = (blob) => `blob:${blob.type}`;

  await replays.listFeaturedReplays();
  await replays.getReplay('replay-1');
  await replays.getReplayEvents('replay-1');
  await replays.getReplayComments('replay-1');
  await assert.rejects(
    () => replays.fetchReplayChunkBlob('replay-1', 404),
    /chunk fetch failed/
  );

  const emptyHttp = mockHttp();
  emptyHttp.fetch = async (path, init) => {
    emptyHttp.calls.push({method: 'FETCH', path, init});
    return new Response('', {status: 404});
  };
  await assert.rejects(
    () => new ReplayApi(emptyHttp).waitForReplayVideo('replay-empty', 10),
    /video not ready/
  );

  await upload.createMultipartUpload('replay-1');
  await upload.uploadMultipartPart('replay-1', 1, new Blob(['part']));
  await upload.completeMultipartUpload('replay-1');

  assert.match(
    http.calls.find((call) => call.path.includes('/featured'))?.path ?? '',
    /featured$/
  );
  assert.match(
    http.calls.find((call) => call.path.includes('/mpu/create'))?.path ?? '',
    /mpu\/create$/
  );
});

test('RecordingUploadApi scopes event sequence per replay id', async () => {
  const http = mockHttp();
  const upload = new RecordingUploadApi(http);
  const event = {
    eventId: 'evt-1',
    replayId: 'replay-a',
    type: 'command_entered',
    atMs: 1,
    actor: 'player',
    payload: {},
    visibility: 'public_safe',
  };

  await upload.uploadEvents('replay-a', [event]);
  await upload.uploadEvents('replay-a', [event]);
  await upload.uploadEvents('replay-b', [event]);
  assert.match(http.calls[0]?.path ?? '', /events\?seq=0$/);
  assert.match(http.calls[1]?.path ?? '', /events\?seq=1$/);
  assert.match(http.calls[2]?.path ?? '', /events\?seq=0$/);

  upload.resetEventSequence('replay-a');
  await upload.uploadEvents('replay-a', [event]);
  assert.match(http.calls[3]?.path ?? '', /events\?seq=0$/);

  upload.resetEventSequence();
  await upload.uploadEvents('replay-b', [event]);
  assert.match(http.calls.at(-1)?.path ?? '', /events\?seq=0$/);

  await upload.uploadChunk('replay-a', {
    seq: 2,
    blob: new Blob(['x']),
    startedAtMs: 0,
    endedAtMs: 1000,
  });
  assert.match(http.calls.at(-1)?.path ?? '', /chunks\?seq=2/);
});
