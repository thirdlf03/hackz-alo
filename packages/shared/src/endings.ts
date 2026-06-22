/** Maps session result to a stable ending id for future branching. */
export function resolveEndingId(result: string): string {
  switch (result) {
    case 'resolved':
      return 'clear-shift';
    case 'false_resolve':
      return 'false-resolve';
    case 'failed':
      return 'overtime';
    case 'timeout':
      return 'overtime';
    case 'retired':
      return 'early-exit';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/** Normalizes internal finish reasons to values allowed in replays.result. */
export function normalizeReplayResult(result: string): string {
  if (result === 'timeout' || result === 'false_resolve') return 'failed';
  return result;
}
