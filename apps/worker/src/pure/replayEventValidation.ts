import {
  REPLAY_EVENT_TYPES,
  REPLAY_EVENT_VISIBILITY_VALUES,
  type ReplayEvent,
} from '@incident/shared';

const replayEventTypes = new Set<string>(REPLAY_EVENT_TYPES);
const replayEventVisibilities = new Set<string>(REPLAY_EVENT_VISIBILITY_VALUES);
const replayEventActors = new Set<string>([
  'player',
  'system',
  'scenario',
  'sandbox',
]);
const maxReplayEventsPerBatch = 500;
const maxReplayEventPayloadBytes = 8 * 1024;

export class ReplayEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayEventValidationError';
  }
}

export function validateReplayEventBatch(
  replayId: string,
  value: unknown
): ReplayEvent[] {
  if (!Array.isArray(value)) {
    throw new ReplayEventValidationError('events must be an array');
  }
  if (value.length > maxReplayEventsPerBatch) {
    throw new ReplayEventValidationError('too many replay events');
  }
  return value.map((event, index) =>
    validateReplayEvent(replayId, event, index)
  );
}

function validateReplayEvent(
  replayId: string,
  value: unknown,
  index: number
): ReplayEvent {
  if (!isRecord(value)) {
    throw invalid(index, 'event must be an object');
  }
  const id = value.id;
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > 128) {
    throw invalid(index, 'id is required');
  }
  if (
    typeof value.replayId === 'string' &&
    value.replayId.length > 0 &&
    value.replayId !== replayId
  ) {
    throw invalid(index, 'replayId does not match route');
  }
  if (typeof value.type !== 'string' || !replayEventTypes.has(value.type)) {
    throw invalid(index, 'unknown event type');
  }
  if (typeof value.actor !== 'string' || !replayEventActors.has(value.actor)) {
    throw invalid(index, 'unknown event actor');
  }
  if (
    typeof value.visibility !== 'string' ||
    !replayEventVisibilities.has(value.visibility)
  ) {
    throw invalid(index, 'unknown event visibility');
  }
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) {
    throw invalid(index, 'at must be a finite number');
  }
  if (!isRecord(value.payload)) {
    throw invalid(index, 'payload must be an object');
  }
  if (jsonByteLength(value.payload) > maxReplayEventPayloadBytes) {
    throw invalid(index, 'payload is too large');
  }

  const event: ReplayEvent = {
    id,
    replayId,
    type: value.type as ReplayEvent['type'],
    at: Math.max(0, Math.floor(value.at)),
    actor: value.actor as ReplayEvent['actor'],
    payload: value.payload,
    visibility: value.visibility as ReplayEvent['visibility'],
  };
  if (typeof value.wallTime === 'string') event.wallTime = value.wallTime;
  return event;
}

function invalid(index: number, message: string) {
  return new ReplayEventValidationError(`events[${String(index)}]: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
