import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {handleSessionAlarm} = await tsImport(
  '../../apps/worker/src/durable/sessionLifecycle.ts',
  import.meta.url
);

const runningSession = {
  sessionId: 'sess_alarm',
  replayId: 'repl_alarm',
  scenarioId: 'process-stop',
  status: 'running',
  gameTimeMs: 999_999,
  gameSpeed: 1,
  gameClockWallMs: Date.now() - 60_000,
  triggeredIds: [],
  firedAlertIds: [],
  firedChatIds: [],
  eventSeq: 0,
  bufferedEvents: [],
};

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      return data.get(key);
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
      return true;
    },
    async deleteAlarm() {},
    async setAlarm() {},
  };
}

test('handleSessionAlarm deletes briefing sessions', async () => {
  const calls = [];
  await handleSessionAlarm({
    storage: createStorage(),
    sseHubSize: 0,
    getSession: async () => ({
      ...runningSession,
      status: 'briefing',
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 5,
    }),
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['delete']);
});

test('handleSessionAlarm times out when game limit is reached', async () => {
  const calls = [];
  await handleSessionAlarm({
    storage: createStorage(),
    sseHubSize: 0,
    getSession: async () => runningSession,
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 1,
    }),
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['timeout']);
});

test('handleSessionAlarm times out idle sessions without SSE clients', async () => {
  const calls = [];
  const idleSince = Date.now() - 10 * 60 * 1000;
  await handleSessionAlarm({
    storage: createStorage({lastClientActivityAt: idleSince}),
    sseHubSize: 0,
    getSession: async () => ({
      ...runningSession,
      gameTimeMs: 0,
      gameClockWallMs: Date.now(),
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 60,
    }),
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['timeout']);
});

test('handleSessionAlarm reschedules when session is still active', async () => {
  const calls = [];
  await handleSessionAlarm({
    storage: createStorage({lastClientActivityAt: Date.now()}),
    sseHubSize: 1,
    getSession: async () => ({
      ...runningSession,
      gameTimeMs: 0,
      gameClockWallMs: Date.now(),
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 60,
    }),
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['schedule']);
});

test('handleSessionAlarm times out once all participants have been offline for the idle window, even with SSE clients still connected', async () => {
  const calls = [];
  const offlineSince = Date.now() - 10 * 60 * 1000;
  await handleSessionAlarm({
    storage: createStorage({
      lastClientActivityAt: Date.now(),
      allParticipantsOfflineSince: offlineSince,
    }),
    // A hidden/backgrounded tab keeps its SSE connection open even once
    // its participant heartbeat goes stale, so this path must fire
    // regardless of sseHubSize.
    sseHubSize: 1,
    getSession: async () => ({
      ...runningSession,
      gameTimeMs: 0,
      gameClockWallMs: Date.now(),
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 60,
    }),
    hasOnlineParticipants: async () => false,
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['timeout']);
});

test('handleSessionAlarm reschedules (not times out) the first time all participants go offline, and records when it started', async () => {
  const calls = [];
  const storage = createStorage({lastClientActivityAt: Date.now()});
  await handleSessionAlarm({
    storage,
    sseHubSize: 1,
    getSession: async () => ({
      ...runningSession,
      gameTimeMs: 0,
      gameClockWallMs: Date.now(),
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 60,
    }),
    hasOnlineParticipants: async () => false,
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['schedule']);
  assert.equal(
    typeof (await storage.get('allParticipantsOfflineSince')),
    'number'
  );
});

test('handleSessionAlarm clears the offline-since marker once a participant comes back online', async () => {
  const calls = [];
  const storage = createStorage({
    lastClientActivityAt: Date.now(),
    allParticipantsOfflineSince: Date.now() - 60_000,
  });
  await handleSessionAlarm({
    storage,
    sseHubSize: 1,
    getSession: async () => ({
      ...runningSession,
      gameTimeMs: 0,
      gameClockWallMs: Date.now(),
    }),
    requireScenario: () => ({
      id: 'process-stop',
      timeLimitMinutes: 60,
    }),
    hasOnlineParticipants: async () => true,
    handlers: {
      deleteSession: async () => {
        calls.push('delete');
      },
      timeout: async () => {
        calls.push('timeout');
      },
      scheduleLifecycleAlarms: async () => {
        calls.push('schedule');
      },
    },
  });
  assert.deepEqual(calls, ['schedule']);
  assert.equal(await storage.get('allParticipantsOfflineSince'), undefined);
});
