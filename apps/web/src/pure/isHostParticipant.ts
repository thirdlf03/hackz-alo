import type {ExerciseSnapshot} from '@incident/shared';

/**
 * A participant is treated as host when no host has been assigned yet, or
 * when they match the assigned host. Used to gate host-only UI (start
 * button, recording consent) and host-only session-lifecycle side effects
 * (recording start, replay finalize on the SSE resolved-phase path) so
 * guests never record or double-finalize a replay.
 */
export function isHostParticipant(
  exerciseSnapshot: ExerciseSnapshot | undefined,
  participantId: string
): boolean {
  return (
    !exerciseSnapshot ||
    exerciseSnapshot.hostParticipantId === null ||
    exerciseSnapshot.hostParticipantId === participantId
  );
}
