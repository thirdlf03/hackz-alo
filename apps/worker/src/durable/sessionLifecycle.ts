import type {ScenarioDefinition} from '@incident/shared';
import {messageFrom} from '../http/response.js';
import {getGameTimeMs, type StoredSession} from './sessionState.js';
import {lifecycleAlarmDeadline} from './sessionClock.js';

export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const BRIEFING_TIMEOUT_MS = 15 * 60 * 1000;
export const GAME_END_BUFFER_MS = 60 * 1000;

export interface SessionLifecycleStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAlarm(): Promise<void>;
  setAlarm(deadline: number): Promise<void>;
}

export async function scheduleSessionLifecycleAlarms(
  storage: SessionLifecycleStorage,
  session: StoredSession,
  scenario: ScenarioDefinition,
  sseHubSize: number
) {
  if (session.status !== 'running') return;

  const lastActivity =
    (await storage.get<number>('lastClientActivityAt')) ?? Date.now();
  const deadline = lifecycleAlarmDeadline({
    session,
    timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    gameEndBufferMs: GAME_END_BUFFER_MS,
    lastActivityAt: lastActivity,
    hasSseClients: sseHubSize > 0,
  });
  if (deadline !== undefined) await storage.setAlarm(deadline);
}

export async function clearSessionLifecycleAlarms(
  storage: SessionLifecycleStorage
) {
  await storage.deleteAlarm();
  await storage.delete('lastClientActivityAt');
  await storage.delete('allParticipantsOfflineSince');
}

export async function touchSessionClientActivity(
  storage: SessionLifecycleStorage,
  session: StoredSession | undefined,
  scenario: ScenarioDefinition | undefined,
  sseHubSize: number
) {
  await storage.put('lastClientActivityAt', Date.now());
  if (session?.status === 'running' && scenario) {
    await scheduleSessionLifecycleAlarms(
      storage,
      session,
      scenario,
      sseHubSize
    );
  }
}

export interface SessionAlarmHandlers {
  deleteSession: () => Promise<unknown>;
  timeout: () => Promise<unknown>;
  scheduleLifecycleAlarms: (
    session: StoredSession,
    scenario: ScenarioDefinition
  ) => Promise<unknown>;
}

export async function handleSessionAlarm(input: {
  storage: SessionLifecycleStorage;
  sseHubSize: number;
  getSession: () => Promise<StoredSession | undefined>;
  requireScenario: (scenarioId: string) => ScenarioDefinition;
  handlers: SessionAlarmHandlers;
  /**
   * Whether any exercise-room participant is currently online (lastSeenAt
   * within the presence window — see exerciseRoom.ts isParticipantOnline).
   * Optional so callers/tests that don't care about the all-offline
   * cleanup below can omit it; when omitted, that check is skipped
   * (treated as if participants are online), preserving prior behavior.
   * A backgrounded/hidden tab keeps its SSE connection open even once its
   * participant heartbeat goes stale, so this is a separate signal from
   * `sseHubSize` — see the idleDeadline comment in sessionLifecycleClock.ts
   * for why the alarm now reliably re-fires often enough to observe it.
   */
  hasOnlineParticipants?: () => Promise<boolean>;
}) {
  try {
    const session = await input.getSession();
    if (!session) return;

    if (session.status === 'briefing') {
      await input.handlers.deleteSession();
      return;
    }

    if (session.status !== 'running') return;

    const scenario = input.requireScenario(session.scenarioId);
    const timeLimitMs = scenario.timeLimitMinutes * 60 * 1000;
    if (getGameTimeMs(session) >= timeLimitMs) {
      await input.handlers.timeout();
      return;
    }

    const lastActivity =
      (await input.storage.get<number>('lastClientActivityAt')) ?? 0;
    if (
      input.sseHubSize === 0 &&
      Date.now() - lastActivity >= SESSION_IDLE_TIMEOUT_MS
    ) {
      await input.handlers.timeout();
      return;
    }

    const hasOnlineParticipants = input.hasOnlineParticipants
      ? await input.hasOnlineParticipants()
      : true;
    if (!hasOnlineParticipants) {
      const offlineSince =
        (await input.storage.get<number>('allParticipantsOfflineSince')) ??
        Date.now();
      await input.storage.put('allParticipantsOfflineSince', offlineSince);
      if (Date.now() - offlineSince >= SESSION_IDLE_TIMEOUT_MS) {
        await input.handlers.timeout();
        return;
      }
    } else {
      await input.storage.delete('allParticipantsOfflineSince');
    }

    await input.handlers.scheduleLifecycleAlarms(session, scenario);
  } catch (error) {
    console.error('[session-alarm]', messageFrom(error));
  }
}
