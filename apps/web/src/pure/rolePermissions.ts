import type {ParticipantPresence} from '@incident/shared';

/**
 * Mirrors the server-side sandbox gate (see
 * apps/worker/src/pure/exerciseRoom.ts `canOperateSandbox`): terminal
 * input, terminal resize, and editor file writes are limited to the
 * `ops` and `facilitator` roles. Solo rescue: with at most one online
 * participant nothing is restricted. In multiplayer, an unknown or
 * missing participantId is rejected.
 */
export function canOperateSandbox(
  participants: ParticipantPresence[],
  participantId: string | undefined
): boolean {
  if (countOnline(participants) <= 1) return true;
  const participant = findParticipant(participants, participantId);
  if (!participant) return false;
  return participant.role === 'ops' || participant.role === 'facilitator';
}

/**
 * Mirrors the server-side record gate (see
 * apps/worker/src/pure/exerciseRoom.ts `canContributeRecords`):
 * observers are read-only for tasks, incident log entries, and hotwash
 * notes. Same solo rescue and unknown-participant rejection as
 * `canOperateSandbox`.
 */
export function canContributeRecords(
  participants: ParticipantPresence[],
  participantId: string | undefined
): boolean {
  if (countOnline(participants) <= 1) return true;
  const participant = findParticipant(participants, participantId);
  if (!participant) return false;
  return participant.role !== 'observer';
}

function countOnline(participants: ParticipantPresence[]) {
  return participants.filter((participant) => participant.online).length;
}

function findParticipant(
  participants: ParticipantPresence[],
  participantId: string | undefined
) {
  if (!participantId) return undefined;
  return participants.find(
    (participant) => participant.participantId === participantId
  );
}
