export const EDGE_RTT_HISTORY_LIMIT = 24;

export function appendEdgeRttHistory(
  history: number[],
  rttMs: number,
  limit = EDGE_RTT_HISTORY_LIMIT
) {
  return [...history, rttMs].slice(-limit);
}

export function roundSessionEdgeRtt(durationMs: number) {
  return Math.max(0, Math.round(durationMs));
}
