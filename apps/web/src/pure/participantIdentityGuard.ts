const CHANNEL_PREFIX = 'incident-participant-guard:';

/**
 * BroadcastChannel name derived from a participantId. Duplicated tabs (e.g.
 * Chrome's "Duplicate tab", which copies sessionStorage verbatim) start out
 * with the same participantId and therefore compute the same channel name,
 * letting them detect each other on mount (see useParticipantIdentityGuard).
 */
export function participantGuardChannelName(participantId: string): string {
  return `${CHANNEL_PREFIX}${participantId}`;
}

export interface ParticipantGuardPingMessage {
  type: 'ping';
  requestId: string;
}

export interface ParticipantGuardPongMessage {
  type: 'pong';
  requestId: string;
}

export function buildParticipantGuardPingMessage(
  requestId: string
): ParticipantGuardPingMessage {
  return {type: 'ping', requestId};
}

export function buildParticipantGuardPongMessage(
  requestId: string
): ParticipantGuardPongMessage {
  return {type: 'pong', requestId};
}

export function isParticipantGuardPingMessage(
  value: unknown
): value is ParticipantGuardPingMessage {
  return isGuardMessageOfType(value, 'ping');
}

export function isParticipantGuardPongMessage(
  value: unknown
): value is ParticipantGuardPongMessage {
  return isGuardMessageOfType(value, 'pong');
}

function isGuardMessageOfType<T extends 'ping' | 'pong'>(
  value: unknown,
  type: T
): value is {type: T; requestId: string} {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === type && typeof record.requestId === 'string';
}
