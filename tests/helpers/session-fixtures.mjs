import {tsImport} from 'tsx/esm/api';

export const {
  buildClockPayload,
  buildSessionSnapshot,
  createBriefingSession,
  finishStoredSession,
  getGameTimeMs,
  isTerminalStatus,
  startStoredSession,
} = await tsImport(
  '../../apps/worker/src/durable/sessionState.ts',
  import.meta.url
);
