import type {Screen} from '../app/appTypes.js';

export function computeLiveGameTimeMs(options: {
  screen: Screen;
  baseMs: number;
  lastTickAt: number;
  speed: number;
  timeLimitMs: number;
  finishing: boolean;
  now: number;
}) {
  const {screen, baseMs, lastTickAt, speed, timeLimitMs, finishing, now} =
    options;
  if (screen !== 'play' || !lastTickAt || finishing) {
    return Math.round(baseMs);
  }
  const elapsedSinceTickMs = Math.max(0, now - lastTickAt) * speed;
  return Math.round(Math.min(timeLimitMs, baseMs + elapsedSinceTickMs));
}

export function snapElapsedMsOnSpeedChange(options: {
  elapsedMs: number;
  timeLimitMs: number;
  lastTickAt: number;
  oldSpeed: number;
  now: number;
}) {
  const {elapsedMs, timeLimitMs, lastTickAt, oldSpeed, now} = options;
  const anchor = lastTickAt || now;
  return Math.min(
    timeLimitMs,
    Math.round(elapsedMs + Math.max(0, now - anchor) * oldSpeed)
  );
}
