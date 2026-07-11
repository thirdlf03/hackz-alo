import {
  canDeclareRecovery,
  type ReplayEvent,
  type SessionStatus,
} from '@incident/shared';
import {jsonOk} from '../http/response.js';
import type {Bindings} from '../types.js';
import {
  computeServiceHealthMap,
  diffServiceHealth,
} from '../pure/serviceHealthMap.js';
import {evaluateSuccessCondition} from '../sandbox/runtime.js';
import {requireScenario} from './sessionExerciseHandlers.js';
import {
  getGameTimeMs,
  type StoredSession,
  type SuccessCheck,
} from './sessionState.js';

export interface SessionResolveDeps {
  env: Bindings;
  finishSession: (
    session: StoredSession,
    status: SessionStatus,
    result: string
  ) => Promise<StoredSession>;
  emit: (
    session: StoredSession,
    type: ReplayEvent['type'],
    at: number,
    actor: ReplayEvent['actor'],
    payload: Record<string, unknown>
  ) => Promise<StoredSession>;
  snapshotFor: (session: StoredSession) => unknown;
  broadcast: (event: string, data: unknown) => void;
}

/**
 * Player-declared recovery: evaluates the scenario success conditions
 * against the sandbox, finishes the session as resolved or failed
 * (false resolve), and emits the resulting replay / service-health
 * events.
 */
export async function resolveSessionAction(
  session: StoredSession,
  deps: SessionResolveDeps
) {
  const scenario = requireScenario(session.scenarioId);
  const incidentStarted = canDeclareRecovery(scenario, session.triggeredIds);
  const checks: SuccessCheck[] = await Promise.all(
    scenario.successConditions.map(async (condition) => ({
      condition,
      ok: await evaluateSuccessCondition(
        deps.env,
        session.sessionId,
        condition
      ),
    }))
  );
  const resolved = incidentStarted && checks.every((check) => check.ok);
  const beforeHealth = computeServiceHealthMap(
    scenario.topology,
    scenario.triggers.filter((t) => session.triggeredIds.includes(t.id)),
    session.status === 'resolved'
  );
  const finished = await deps.finishSession(
    session,
    resolved ? 'resolved' : 'failed',
    resolved ? 'resolved' : 'false_resolve'
  );
  let result = await deps.emit(
    finished,
    resolved ? 'incident_resolved' : 'session_end',
    getGameTimeMs(finished),
    resolved ? 'system' : 'player',
    resolved ? {checks} : {result: 'false_resolve', checks}
  );
  const afterHealth = computeServiceHealthMap(
    scenario.topology,
    scenario.triggers.filter((t) => result.triggeredIds.includes(t.id)),
    result.status === 'resolved'
  );
  for (const change of diffServiceHealth(
    beforeHealth,
    afterHealth,
    scenario.topology
  )) {
    result = await deps.emit(
      result,
      'service_health_changed',
      getGameTimeMs(finished),
      'system',
      {...change}
    );
  }
  deps.broadcast('snapshot', deps.snapshotFor(result));
  return jsonOk({
    ok: resolved,
    checks,
    session: deps.snapshotFor(result),
  });
}
