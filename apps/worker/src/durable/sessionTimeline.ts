import type {ReplayEvent, ScenarioDefinition} from '@incident/shared';
import {getGameTimeMs, type StoredSession} from './sessionState.js';

export interface PendingTimer {
  kind: 'trigger' | 'alert' | 'slack';
  id: string;
  handle: ReturnType<typeof setTimeout>;
}

export interface SessionTimelineDependencies {
  loadSession(): Promise<StoredSession>;
  saveSession(session: StoredSession): Promise<void>;
  injectFault(
    sessionId: string,
    type: string,
    params: Record<string, unknown>
  ): Promise<void>;
  emit(
    session: StoredSession,
    type: ReplayEvent['type'],
    at: number,
    actor: ReplayEvent['actor'],
    payload: Record<string, unknown>
  ): Promise<StoredSession>;
  snapshotFor(session: StoredSession): unknown;
  broadcastSse(event: string, data: unknown): void;
}

export class SessionTimeline {
  private pendingTimers: PendingTimer[] = [];

  constructor(private dependencies: SessionTimelineDependencies) {}

  clear() {
    for (const timer of this.pendingTimers) clearTimeout(timer.handle);
    this.pendingTimers = [];
  }

  reschedule(session: StoredSession, scenario: ScenarioDefinition) {
    this.clear();
    if (session.status !== 'running') return;
    this.schedule(session, scenario);
  }

  schedule(session: StoredSession, scenario: ScenarioDefinition) {
    for (const trigger of scenario.triggers) {
      if (session.triggeredIds.includes(trigger.id)) continue;
      this.scheduleAtGameTime(
        session,
        trigger.atMs,
        'trigger',
        trigger.id,
        async () => {
          const latest = await this.dependencies.loadSession();
          if (
            latest.status !== 'running' ||
            latest.triggeredIds.includes(trigger.id)
          ) {
            return;
          }
          try {
            await this.dependencies.injectFault(
              latest.sessionId,
              trigger.type,
              trigger.params as Record<string, unknown>
            );
            let triggered: StoredSession = {
              ...latest,
              triggeredIds: [...latest.triggeredIds, trigger.id],
            };
            await this.dependencies.saveSession(triggered);
            triggered = await this.dependencies.emit(
              triggered,
              'scenario_event',
              trigger.atMs,
              'scenario',
              {trigger}
            );
            this.dependencies.broadcastSse(
              'snapshot',
              this.dependencies.snapshotFor(triggered)
            );
          } catch (error) {
            await this.dependencies.emit(
              latest,
              'sandbox_error',
              trigger.atMs,
              'sandbox',
              {
                triggerId: trigger.id,
                message: messageFrom(error),
              }
            );
          }
        }
      );
    }

    for (const alert of scenario.alerts) {
      if (session.firedAlertIds.includes(alert.id)) continue;
      this.scheduleAtGameTime(
        session,
        alert.atMs,
        'alert',
        alert.id,
        async () => {
          const latest = await this.dependencies.loadSession();
          if (
            latest.status !== 'running' ||
            latest.firedAlertIds.includes(alert.id)
          ) {
            return;
          }
          const next: StoredSession = {
            ...latest,
            firedAlertIds: [...latest.firedAlertIds, alert.id],
          };
          await this.dependencies.saveSession(next);
          const updated = await this.dependencies.emit(
            next,
            'alert',
            alert.atMs,
            'scenario',
            {
              alertId: alert.id,
              message: alert.message,
              severity: alert.severity,
            }
          );
          this.dependencies.broadcastSse(
            'replay',
            updated.bufferedEvents.at(-1)
          );
          this.dependencies.broadcastSse(
            'snapshot',
            this.dependencies.snapshotFor(updated)
          );
        }
      );
    }

    for (const message of scenario.slackMessages) {
      if (session.firedSlackIds.includes(message.id)) continue;
      this.scheduleAtGameTime(
        session,
        message.atMs,
        'slack',
        message.id,
        async () => {
          const latest = await this.dependencies.loadSession();
          if (
            latest.status !== 'running' ||
            latest.firedSlackIds.includes(message.id)
          ) {
            return;
          }
          const next: StoredSession = {
            ...latest,
            firedSlackIds: [...latest.firedSlackIds, message.id],
          };
          await this.dependencies.saveSession(next);
          this.dependencies.broadcastSse(
            'snapshot',
            this.dependencies.snapshotFor(next)
          );
        }
      );
    }
  }

  private scheduleAtGameTime(
    session: StoredSession,
    atMs: number,
    kind: PendingTimer['kind'],
    id: string,
    run: () => Promise<void>
  ) {
    const delay = Math.max(
      0,
      (atMs - getGameTimeMs(session)) / Math.max(session.gameSpeed, 0.1)
    );
    const handle = setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter(
        (timer) => timer.handle !== handle
      );
      void run();
    }, delay);
    this.pendingTimers.push({kind, id, handle});
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'session request failed';
}
