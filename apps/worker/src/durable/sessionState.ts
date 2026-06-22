import type {
  AlertDefinition,
  ReplayEvent,
  ScenarioDefinition,
  SessionStatus,
} from '@incident/shared';
import {computeGameTimeMs} from '../pure/sessionTime.js';

export interface StoredSession {
  sessionId: string;
  replayId: string;
  scenarioId: string;
  status: SessionStatus;
  startedAt?: string;
  finishedAt?: string;
  gameTimeMs: number;
  gameSpeed: number;
  gameClockWallMs?: number;
  triggeredIds: string[];
  firedAlertIds: string[];
  firedSlackIds: string[];
  eventSeq: number;
  bufferedEvents: ReplayEvent[];
}

export type SessionBootstrap = Pick<
  StoredSession,
  'sessionId' | 'replayId' | 'scenarioId'
>;

export interface SuccessCheck {
  condition: ScenarioDefinition['successConditions'][number];
  ok: boolean;
}

export function createBriefingSession(input: SessionBootstrap): StoredSession {
  return {
    sessionId: input.sessionId,
    replayId: input.replayId,
    scenarioId: input.scenarioId,
    status: 'briefing',
    gameTimeMs: 0,
    gameSpeed: 1,
    triggeredIds: [],
    firedAlertIds: [],
    firedSlackIds: [],
    eventSeq: 0,
    bufferedEvents: [],
  };
}

export function startStoredSession(
  session: StoredSession,
  startedAt: string,
  nowMs: number
): StoredSession {
  return {
    ...session,
    status: 'running',
    startedAt,
    gameTimeMs: 0,
    gameSpeed: session.gameSpeed || 1,
    gameClockWallMs: nowMs,
  };
}

export function finishStoredSession(
  session: StoredSession,
  status: SessionStatus,
  finishedAt: string,
  nowMs: number
): StoredSession {
  const {gameClockWallMs: _gameClockWallMs, ...sessionWithoutWall} = session;
  return {
    ...sessionWithoutWall,
    status,
    gameTimeMs: getGameTimeMs(session, nowMs),
    finishedAt,
  };
}

export function getGameTimeMs(session: StoredSession, nowMs = Date.now()) {
  return computeGameTimeMs(session, nowMs);
}

export function isTerminalStatus(status: SessionStatus) {
  return (
    status === 'resolved' ||
    status === 'failed' ||
    status === 'retired' ||
    status === 'aborted'
  );
}

export function buildSessionSnapshot(
  session: StoredSession,
  scenario: ScenarioDefinition,
  nowMs = Date.now()
) {
  const gameTimeMs = getGameTimeMs(session, nowMs);
  return {
    ...session,
    gameTimeMs,
    elapsedMs: gameTimeMs,
    alerts: firedAlerts(scenario, session),
    slackMessages: firedSlackMessages(scenario, session),
    scenario,
  };
}

export function buildClockPayload(
  session: StoredSession,
  scenario: ScenarioDefinition,
  nowMs = Date.now()
) {
  return {
    gameTimeMs: getGameTimeMs(session, nowMs),
    gameSpeed: session.gameSpeed,
    timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
    alerts: firedAlerts(scenario, session),
    slackMessages: firedSlackMessages(scenario, session),
  };
}

function firedAlerts(
  scenario: ScenarioDefinition,
  session: StoredSession
): AlertDefinition[] {
  return scenario.alerts.filter((alert) =>
    session.firedAlertIds.includes(alert.id)
  );
}

function firedSlackMessages(
  scenario: ScenarioDefinition,
  session: StoredSession
) {
  return scenario.slackMessages.filter((message) =>
    session.firedSlackIds.includes(message.id)
  );
}
