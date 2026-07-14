/**
 * Wraps an async `compute` in a TTL cache with in-flight promise merging:
 * concurrent callers share the same in-progress computation, and callers
 * within the TTL window after it settles get the cached result instead of
 * re-running `compute`. Used to absorb repeat/near-simultaneous calls to
 * work that is expensive or has side effects (e.g. a sandbox exec).
 */
export function createInflightTtlCache<TArgs extends unknown[], TResult>(
  compute: (...args: TArgs) => Promise<TResult>,
  ttlMs: number,
  now: () => number = Date.now
) {
  let cache: {result: TResult; expiresAt: number} | undefined;
  let inFlight: Promise<TResult> | undefined;

  return (...args: TArgs): Promise<TResult> => {
    if (cache && cache.expiresAt > now()) {
      return Promise.resolve(cache.result);
    }
    inFlight ??= compute(...args)
      .then((result) => {
        cache = {result, expiresAt: now() + ttlMs};
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
