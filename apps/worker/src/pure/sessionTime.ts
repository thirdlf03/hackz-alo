interface RunningSessionClock {
  status: string;
  gameTimeMs: number;
  gameSpeed: number;
  gameClockWallMs?: number;
}

export function computeGameTimeMs(session: RunningSessionClock, nowMs: number) {
  if (session.status !== 'running' || !session.gameClockWallMs) {
    return session.gameTimeMs;
  }
  const wallDelta = nowMs - session.gameClockWallMs;
  return Math.max(
    0,
    Math.round(session.gameTimeMs + wallDelta * session.gameSpeed)
  );
}
