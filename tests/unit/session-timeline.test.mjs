import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {SessionTimeline} = await tsImport(
  '../../apps/worker/src/durable/sessionTimeline.ts',
  import.meta.url
);

test('SessionTimeline fires scenario triggers through injected fault handlers', async () => {
  const harness = createTimelineHarness(testSession({gameTimeMs: 100}));
  const scenario = testScenario({
    triggers: [
      {
        id: 'trigger_1',
        atMs: 0,
        type: 'process_stop',
        params: {processId: 'api'},
      },
    ],
  });

  harness.timeline.schedule(harness.session, scenario);
  await waitForTimers();

  assert.deepEqual(harness.calls.injected, [
    ['sess_1', 'process_stop', {processId: 'api'}],
  ]);
  assert.deepEqual(harness.session.triggeredIds, ['trigger_1']);
  assert.deepEqual(
    harness.calls.emitted.map((event) => event.type),
    ['scenario_event']
  );
  assert.equal(harness.calls.broadcasts.at(-1).event, 'snapshot');
});

test('SessionTimeline emits sandbox errors when trigger injection fails', async () => {
  const harness = createTimelineHarness(testSession({gameTimeMs: 100}), {
    injectError: new Error('sandbox offline'),
  });
  const scenario = testScenario({
    triggers: [
      {
        id: 'trigger_1',
        atMs: 0,
        type: 'process_stop',
        params: {processId: 'api'},
      },
    ],
  });

  harness.timeline.schedule(harness.session, scenario);
  await waitForTimers();

  assert.deepEqual(harness.session.triggeredIds, []);
  assert.equal(harness.calls.emitted[0].type, 'sandbox_error');
  assert.deepEqual(harness.calls.emitted[0].payload, {
    triggerId: 'trigger_1',
    message: 'sandbox offline',
  });
});

test('SessionTimeline fires alerts and chat messages', async () => {
  const harness = createTimelineHarness(testSession({gameTimeMs: 100}));
  const scenario = testScenario({
    alerts: [
      {
        id: 'alert_1',
        atMs: 0,
        severity: 'critical',
        message: 'API down',
        source: 'monitor',
      },
    ],
    chatMessages: [
      {
        id: 'chat_1',
        atMs: 0,
        from: 'SRE',
        body: 'checking',
      },
    ],
  });

  harness.timeline.schedule(harness.session, scenario);
  await waitForTimers();

  assert.deepEqual(harness.session.firedAlertIds, ['alert_1']);
  assert.deepEqual(harness.session.firedChatIds, ['chat_1']);
  assert.deepEqual(
    harness.calls.emitted.map((event) => event.type),
    ['alert']
  );
  assert.deepEqual(
    harness.calls.broadcasts.map((entry) => entry.event),
    ['replay', 'snapshot', 'snapshot']
  );
});

test('SessionTimeline reschedule clears pending timers', async () => {
  const harness = createTimelineHarness(testSession({gameTimeMs: 0}));
  const scenario = testScenario({
    alerts: [
      {
        id: 'alert_1',
        atMs: 30,
        severity: 'warning',
        message: 'later',
        source: 'monitor',
      },
    ],
  });

  harness.timeline.schedule(harness.session, scenario);
  harness.timeline.reschedule(
    {...harness.session, status: 'briefing'},
    scenario
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(harness.calls.emitted, []);
  assert.deepEqual(harness.session.firedAlertIds, []);
});

function createTimelineHarness(initialSession, options = {}) {
  let session = initialSession;
  const calls = {
    broadcasts: [],
    emitted: [],
    injected: [],
    saved: [],
  };
  const timeline = new SessionTimeline({
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
      calls.saved.push(next);
    },
    injectFault: async (sessionId, type, params) => {
      calls.injected.push([sessionId, type, params]);
      if (options.injectError) throw options.injectError;
    },
    emit: async (input, type, at, actor, payload) => {
      calls.emitted.push({type, at, actor, payload});
      const event = {
        id: `evt_${calls.emitted.length}`,
        replayId: input.replayId,
        type,
        at,
        actor,
        payload,
        visibility: 'public_safe',
      };
      const next = {
        ...input,
        eventSeq: input.eventSeq + 1,
        bufferedEvents: [...input.bufferedEvents, event],
      };
      session = next;
      return next;
    },
    snapshotFor: (input) => ({
      sessionId: input.sessionId,
      triggeredIds: input.triggeredIds,
      firedAlertIds: input.firedAlertIds,
      firedChatIds: input.firedChatIds,
    }),
    broadcastSse: (event, data) => {
      calls.broadcasts.push({event, data});
    },
  });

  return {
    timeline,
    calls,
    get session() {
      return session;
    },
  };
}

function waitForTimers() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function testSession(overrides = {}) {
  return {
    sessionId: 'sess_1',
    replayId: 'repl_1',
    scenarioId: 'scenario_1',
    status: 'running',
    gameTimeMs: 0,
    gameSpeed: 1,
    triggeredIds: [],
    firedAlertIds: [],
    firedChatIds: [],
    eventSeq: 0,
    bufferedEvents: [],
    ...overrides,
  };
}

function testScenario(overrides = {}) {
  return {
    id: 'scenario_1',
    version: 1,
    title: 'Scenario',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {name: 'API', healthUrl: 'http://127.0.0.1:8080/health'},
    briefing: [],
    startup: [],
    triggers: [],
    alerts: [],
    successConditions: [],
    runbooks: [],
    chatMessages: [],
    ...overrides,
  };
}
