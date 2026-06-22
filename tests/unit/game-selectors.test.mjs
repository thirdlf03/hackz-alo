import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  computeNarrativeHour,
  mergedSlackMessages,
  unreadAlertCount,
  unreadNotificationCount,
  visibleRunbooks,
} = await tsImport(
  '../../apps/web/src/game/state/gameSelectors.ts',
  import.meta.url
);

function baseScenario() {
  return {
    id: 'scenario_test',
    version: 1,
    title: 'Test Scenario',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {
      name: 'Test API',
      healthUrl: 'http://localhost:8080/health',
    },
    briefing: [],
    startup: [],
    triggers: [],
    alerts: [],
    successConditions: [],
    runbooks: [
      {id: 'early', title: 'Early', body: 'now'},
      {id: 'late', title: 'Late', body: 'later', availableAtMs: 90_000},
    ],
    slackMessages: [],
  };
}

function baseState() {
  return {
    monitors: {
      left: {
        alerts: [
          {
            id: 'alert-1',
            atMs: 1,
            severity: 'warning',
            title: 'warn',
            body: 'body',
          },
        ],
      },
      right: {
        slackMessages: [{id: 'slack-1', atMs: 2, from: 'SRE', body: 'ping'}],
      },
    },
    playerSlackMessages: [
      {id: 'player-1', atMs: 3, from: 'あなた', body: 'pong'},
    ],
    seenSlackIds: ['slack-1'],
    notifications: {readAlertIds: []},
  };
}

test('visibleRunbooks filters runbooks by scenario timeline', () => {
  const scenario = baseScenario();
  assert.deepEqual(
    visibleRunbooks(scenario, 0).map((book) => book.id),
    ['early']
  );
  assert.deepEqual(
    visibleRunbooks(scenario, 90_000).map((book) => book.id),
    ['early', 'late']
  );
});

test('mergedSlackMessages merges server and player slack in chronological order', () => {
  const messages = mergedSlackMessages(baseState());
  assert.deepEqual(
    messages.map((message) => message.id),
    ['slack-1', 'player-1']
  );
});

test('unread counters ignore seen alerts and slack messages', () => {
  const state = baseState();
  assert.equal(unreadAlertCount(state), 1);
  assert.equal(unreadNotificationCount(state), 2);

  const read = {
    ...state,
    notifications: {readAlertIds: ['alert-1']},
    seenSlackIds: ['slack-1', 'player-1'],
  };
  assert.equal(unreadAlertCount(read), 0);
  assert.equal(unreadNotificationCount(read), 0);
});

test('computeNarrativeHour maps elapsed play time to midnight hours', () => {
  assert.equal(computeNarrativeHour(0, 60_000), 0);
  assert.equal(computeNarrativeHour(30_000, 60_000), 3);
  assert.equal(computeNarrativeHour(60_000, 60_000), 6);
  assert.equal(computeNarrativeHour(120_000, 60_000), 6);
});
