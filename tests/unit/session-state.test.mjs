import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  buildClockPayload,
  buildSessionSnapshot,
  createBriefingSession,
  finishStoredSession,
  getGameTimeMs,
  isTerminalStatus,
  startStoredSession,
} from '../helpers/session-fixtures.mjs';

test('session state helpers create and start stored sessions', () => {
  const briefing = createBriefingSession({
    sessionId: 'sess_1',
    replayId: 'repl_1',
    scenarioId: 'scenario_1',
  });

  assert.equal(briefing.status, 'briefing');
  assert.equal(briefing.gameTimeMs, 0);
  assert.equal(briefing.gameSpeed, 1);
  assert.deepEqual(briefing.triggeredIds, []);

  const running = startStoredSession(
    {...briefing, gameSpeed: 2},
    '2026-06-22T00:00:00.000Z',
    1_000
  );
  assert.equal(running.status, 'running');
  assert.equal(running.startedAt, '2026-06-22T00:00:00.000Z');
  assert.equal(running.gameClockWallMs, 1_000);
  assert.equal(getGameTimeMs(running, 1_750), 1_500);
});

test('finishStoredSession freezes game time and clears wall clock anchor', () => {
  const running = {
    ...createBriefingSession({
      sessionId: 'sess_1',
      replayId: 'repl_1',
      scenarioId: 'scenario_1',
    }),
    status: 'running',
    gameTimeMs: 500,
    gameSpeed: 2,
    gameClockWallMs: 1_000,
  };

  const finished = finishStoredSession(
    running,
    'resolved',
    '2026-06-22T00:01:00.000Z',
    2_000
  );
  assert.equal(finished.status, 'resolved');
  assert.equal(finished.gameTimeMs, 2_500);
  assert.equal(finished.finishedAt, '2026-06-22T00:01:00.000Z');
  assert.equal('gameClockWallMs' in finished, false);
  assert.equal(getGameTimeMs(finished, 5_000), 2_500);
});

test('terminal status helper matches session end states', () => {
  assert.equal(isTerminalStatus('resolved'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('retired'), true);
  assert.equal(isTerminalStatus('aborted'), true);
  assert.equal(isTerminalStatus('running'), false);
  assert.equal(isTerminalStatus('briefing'), false);
});

test('snapshot and clock payload expose fired timeline state', () => {
  const scenario = testScenario();
  const session = {
    ...createBriefingSession({
      sessionId: 'sess_1',
      replayId: 'repl_1',
      scenarioId: scenario.id,
    }),
    status: 'running',
    gameTimeMs: 1_000,
    gameSpeed: 1,
    gameClockWallMs: 10_000,
    firedAlertIds: ['alert_1'],
    firedSlackIds: ['slack_1'],
  };

  const snapshot = buildSessionSnapshot(session, scenario, 11_500);
  assert.equal(snapshot.gameTimeMs, 2_500);
  assert.equal(snapshot.elapsedMs, 2_500);
  assert.deepEqual(
    snapshot.alerts.map((alert) => alert.id),
    ['alert_1']
  );
  assert.deepEqual(
    snapshot.slackMessages.map((message) => message.id),
    ['slack_1']
  );
  assert.equal(snapshot.scenario, scenario);

  const clock = buildClockPayload(session, scenario, 12_000);
  assert.equal(clock.gameTimeMs, 3_000);
  assert.equal(clock.timeLimitMs, 600_000);
  assert.equal(clock.alerts.length, 1);
  assert.equal(clock.slackMessages.length, 1);
});

function testScenario() {
  return {
    id: 'scenario_1',
    version: 1,
    title: 'Scenario',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {name: 'API', healthUrl: 'http://127.0.0.1:8080/health'},
    briefing: ['brief'],
    startup: [{id: 'api', command: 'node server.mjs'}],
    triggers: [],
    alerts: [
      {
        id: 'alert_1',
        atMs: 1_000,
        severity: 'warning',
        message: 'Latency',
        source: 'scenario',
      },
      {
        id: 'alert_2',
        atMs: 2_000,
        severity: 'critical',
        message: 'Down',
        source: 'scenario',
      },
    ],
    successConditions: [
      {type: 'http_status', url: 'http://127.0.0.1:8080/health', status: 200},
    ],
    runbooks: [{id: 'runbook_1', title: 'Runbook', body: 'body'}],
    slackMessages: [
      {id: 'slack_1', atMs: 1_000, from: 'SRE', body: 'check'},
      {id: 'slack_2', atMs: 2_000, from: 'SRE', body: 'later'},
    ],
  };
}
