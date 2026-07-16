import {canDeclareRecovery, type SuccessCondition} from '@incident/shared';
import type {Bindings} from '../types.js';
import {requireScenario} from './sessionExerciseHandlers.js';
import type {StoredSession, SuccessCheck} from './sessionState.js';

export type EvaluateConditionFn = (
  env: Bindings,
  sessionId: string,
  condition: SuccessCondition
) => Promise<boolean>;

/**
 * Evaluates every success condition against the sandbox. Shared by
 * resolveSessionAction (finish-and-check) and checkRecoveryAction
 * (dry-run) so both exercise the exact same evaluation logic.
 */
export async function evaluateSuccessChecks(
  evaluateCondition: EvaluateConditionFn,
  env: Bindings,
  sessionId: string,
  conditions: readonly SuccessCondition[]
): Promise<SuccessCheck[]> {
  return Promise.all(
    conditions.map(async (condition) => ({
      condition,
      ok: await evaluateCondition(env, sessionId, condition),
    }))
  );
}

export interface RecoveryCheckResult {
  declarable: boolean;
  allOk: boolean;
  checks: SuccessCheck[];
  evaluatedAt: number;
}

export interface SessionRecoveryCheckDeps {
  env: Bindings;
  // Required (no default to the real sandbox evaluator here) so this
  // module stays free of the '@cloudflare/sandbox' import chain — that
  // chain pulls in `cloudflare:workers`, which only resolves inside the
  // Workers runtime and would make this module impossible to unit test
  // under plain node:test. Callers wire the real evaluator in (see
  // SessionDurableObject's evaluateRecoveryCheckCondition field).
  evaluateCondition: EvaluateConditionFn;
}

/**
 * Player-facing "confirm recovery" dry-run: evaluates the scenario success
 * conditions against the sandbox. This function itself never finishes the
 * session, never touches stored session state, and never broadcasts —
 * it stays a pure, side-effect-free dry-run so it's safe to call
 * speculatively/repeatedly. Never calls finishSession and never destroys the
 * sandbox — callers that want the real (session-ending) resolve flow must
 * use resolveSessionAction instead. The DO handler separately calls
 * confirmRecoveryIfNeeded() to persist + broadcast the first allOk result
 * (see SessionDurableObject.recoveryCheck), keeping that side effect out of
 * this function.
 */
export async function checkRecoveryAction(
  session: StoredSession,
  deps: SessionRecoveryCheckDeps
): Promise<RecoveryCheckResult> {
  const scenario = requireScenario(session.scenarioId);
  const declarable = canDeclareRecovery(scenario, session.triggeredIds);
  // When the incident hasn't fully triggered yet, declaring recovery isn't
  // possible regardless of sandbox state, so skip the sandbox exec entirely.
  const checks = declarable
    ? await evaluateSuccessChecks(
        deps.evaluateCondition,
        deps.env,
        session.sessionId,
        scenario.successConditions
      )
    : [];
  return {
    declarable,
    allOk: declarable && checks.every((check) => check.ok),
    checks,
    evaluatedAt: Date.now(),
  };
}

export interface RecoveryConfirmDeps {
  /** Persists the session with recoveryConfirmedAtMs set (DO storage put). */
  persistSession: (session: StoredSession) => Promise<void>;
  /** Broadcasts the updated session snapshot to connected SSE clients. */
  broadcastSnapshot: (session: StoredSession) => void;
}

/**
 * Records the first time a recovery-check reports allOk, so the client's
 * incident banner can show "復旧確認済み" for every participant (not just
 * the one who ran the check) and be restored on reconnect/mid-join — see
 * apps/web/src/game/render/canvasRenderChrome.ts drawAlerts(). Idempotent:
 * once session.recoveryConfirmedAtMs is set, subsequent allOk checks are
 * no-ops. Kept separate from checkRecoveryAction (which stays a pure
 * dry-run) so callers of the dry-run evaluation alone (e.g. tests) aren't
 * forced to also thread persistence/broadcast deps.
 */
export async function confirmRecoveryIfNeeded(
  session: StoredSession,
  result: RecoveryCheckResult,
  deps: RecoveryConfirmDeps,
  nowMs = Date.now()
): Promise<StoredSession> {
  if (!result.allOk || session.recoveryConfirmedAtMs !== undefined) {
    return session;
  }
  const confirmed: StoredSession = {
    ...session,
    recoveryConfirmedAtMs: nowMs,
  };
  await deps.persistSession(confirmed);
  deps.broadcastSnapshot(confirmed);
  return confirmed;
}
