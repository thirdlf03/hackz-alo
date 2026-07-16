import type {ExercisePhase} from '@incident/shared';

/**
 * Screens a resumed session (see useSessionRuntime's
 * resumeSessionFromStorage, triggered on F5 reload when sessionId/writeToken
 * were persisted to sessionStorage) can land on directly, keyed by the
 * server-reported exercise phase at resume time.
 */
export type ResumeScreen = 'lobby' | 'briefing' | 'play' | 'result' | 'hotwash';

/**
 * Maps an exercise phase to the screen a resuming client should land on.
 * lobby/briefing/running funnel through the same SSE-driven cascade an
 * invite-link guest already uses (see useExercisePhaseSync, which upgrades
 * the screen from 'lobby' once exerciseSnapshot.phase advances); resolved/
 * hotwash/aar have no such cascade from a cold 'lobby' start, so this table
 * is also consulted directly to land on 'result'/'hotwash' instead.
 */
export function screenForExercisePhase(phase: ExercisePhase): ResumeScreen {
  switch (phase) {
    case 'lobby':
      return 'lobby';
    case 'briefing':
      return 'briefing';
    case 'running':
      return 'play';
    case 'resolved':
      return 'result';
    case 'hotwash':
    case 'aar':
      return 'hotwash';
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
