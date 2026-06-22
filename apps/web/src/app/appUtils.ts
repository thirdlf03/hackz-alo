import type {Screen} from './appTypes.js';
import {
  computeLiveGameTimeMs as computeLiveGameTimeMsPure,
  snapElapsedMsOnSpeedChange as snapElapsedMsOnSpeedChangePure,
} from '../pure/appClock.js';
import {toErrorMessage} from '../pure/errors.js';
import {containsPoint} from '../pure/geometry.js';

export function readReplayIdFromSearch() {
  if (typeof window === 'undefined') return undefined;
  const replayId = new URLSearchParams(window.location.search)
    .get('replay')
    ?.trim();
  return replayId || undefined;
}

export {toErrorMessage};

export function toLogicalCanvasPoint(
  event: MouseEvent,
  canvas: HTMLCanvasElement
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 1920,
    y: ((event.clientY - rect.top) / rect.height) * 1080,
  };
}

export {containsPoint};

export function computeLiveGameTimeMs(options: {
  screen: Screen;
  baseMs: number;
  lastTickAt: number;
  speed: number;
  timeLimitMs: number;
  finishing: boolean;
}) {
  return computeLiveGameTimeMsPure({
    ...options,
    now: performance.now(),
  });
}

export function snapElapsedMsOnSpeedChange(options: {
  elapsedMs: number;
  timeLimitMs: number;
  lastTickAt: number;
  oldSpeed: number;
  now?: number;
}) {
  return snapElapsedMsOnSpeedChangePure({
    elapsedMs: options.elapsedMs,
    timeLimitMs: options.timeLimitMs,
    lastTickAt: options.lastTickAt,
    oldSpeed: options.oldSpeed,
    now: options.now ?? performance.now(),
  });
}
