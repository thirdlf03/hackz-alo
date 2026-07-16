import type {
  AlertDefinition,
  ReplayEvent,
  ScenarioDefinition,
  SessionStatus,
} from '@incident/shared';
import {computeGameTimeMs} from '../pure/sessionTime.js';
import {computeServiceHealthMap} from '../pure/serviceHealthMap.js';

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
  pagerOriginUrl?: string;
  triggeredIds: string[];
  firedAlertIds: string[];
  firedChatIds: string[];
  eventSeq: number;
  bufferedEvents: ReplayEvent[];
  /** Wall-clock time (ms) the first recovery-check reported allOk, set once
   * and never cleared — the server-side source of truth for the client's
   * "復旧確認済み" incident-banner state (canvasRenderChrome.ts drawAlerts()),
   * consistent across participants and restored on reconnect/mid-join (e.g.
   * invite-link join, SSE resubscribe). See confirmRecoveryIfNeeded() in
   * sessionRecoveryCheck.ts. Undefined means not yet confirmed. */
  recoveryConfirmedAtMs?: number;
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
    firedChatIds: [],
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
  const firedTriggers = scenario.triggers.filter((trigger) =>
    session.triggeredIds.includes(trigger.id)
  );
  return {
    ...session,
    gameTimeMs,
    elapsedMs: gameTimeMs,
    alerts: firedAlerts(scenario, session),
    chatMessages: firedChatMessages(scenario, session),
    scenario,
    serviceHealth: computeServiceHealthMap(
      scenario.topology,
      firedTriggers,
      session.status === 'resolved'
    ),
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
    chatMessages: firedChatMessages(scenario, session),
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

function firedChatMessages(
  scenario: ScenarioDefinition,
  session: StoredSession
) {
  return scenario.chatMessages.filter((message) =>
    session.firedChatIds.includes(message.id)
  );
}
