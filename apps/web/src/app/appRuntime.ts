import {createApiClient} from '../api/client.js';

export type {
  SessionClockResponse,
  SessionSnapshotResponse,
} from '../api/client.js';
export {useCanvasRecording} from './useCanvasRecording.js';
export {useCanvasRenderer} from './useCanvasRenderer.js';
export {useSessionEditor} from './useSessionEditor.js';
export {useTerminalBridge} from './useTerminalBridge.js';

export const api = createApiClient();
