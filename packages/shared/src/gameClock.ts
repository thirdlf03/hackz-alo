/** Shared game-clock helpers used by client and tests. */
export function computeGameTimeMs(
  gameTimeMs: number,
  gameClockWallMs: number | undefined,
  gameSpeed: number,
  now = Date.now(),
  running = true
) {
  if (!running || gameClockWallMs === undefined) return gameTimeMs;
  const wallDelta = now - gameClockWallMs;
  return Math.max(0, Math.round(gameTimeMs + wallDelta * gameSpeed));
}

export function wallDelayForGameMs(
  currentGameMs: number,
  targetGameMs: number,
  gameSpeed: number
) {
  return Math.max(0, (targetGameMs - currentGameMs) / Math.max(gameSpeed, 0.1));
}
