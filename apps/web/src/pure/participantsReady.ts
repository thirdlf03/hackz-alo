import type {ParticipantPresence} from '@incident/shared';

/**
 * Mirrors the server-side start gate (see
 * apps/worker/src/pure/exerciseRoom.ts `areParticipantsReadyToStart`):
 * online participants other than observers must all be ready before the
 * session can start, unless there is at most one of them.
 */
export function areParticipantsReadyToStart(
  participants: ParticipantPresence[]
): boolean {
  const onlineNonObservers = participants.filter(
    (participant) => participant.role !== 'observer' && participant.online
  );
  if (onlineNonObservers.length <= 1) return true;
  return onlineNonObservers.every((participant) => participant.ready);
}
