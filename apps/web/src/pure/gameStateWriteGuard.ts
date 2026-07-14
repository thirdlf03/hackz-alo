/**
 * Guards a "state mirrored from React back into a ref" effect against
 * reverting a newer, directly-written ref value with a stale snapshot.
 *
 * Background: useSessionRuntime keeps two mirrors of game state — the React
 * `gameState` (rendered UI, updated via setGameState) and
 * `gameStateRef.current` (read synchronously by click handlers and the game
 * loop tick so they always see the latest value without waiting for a
 * render). A `useEffect` mirrors `gameState` back into the ref for call
 * sites that only call `setGameState` directly. Under heavy synchronous
 * churn (rapid clicks plus the 500ms game loop tick), the effect flush can
 * lag well behind those direct ref writes, so an effect belonging to an
 * *older* commit can fire after a *newer* commit already wrote the ref —
 * reverting fields such as `monitors.center.activeTool` or
 * `recovery.retireConfirming` back to a stale value (observed as the
 * retire-confirm modal silently not opening, and the editor file list
 * losing its "editor" tool selection, under Playwright's rapid
 * click-and-retry helpers).
 *
 * Direct ref writers call `tag()` on every state object they write. When
 * the mirroring effect later fires for that same object, `shouldApply()`
 * reports whether a *newer* tagged write has since superseded it, so the
 * effect can skip reverting the ref instead of blindly overwriting it.
 * States never passed to `tag()` (produced by code that only calls
 * setGameState directly) are always considered applicable, preserving
 * prior behavior for those call sites.
 */
export interface GameStateWriteGuard<T extends object> {
  tag(state: T): T;
  shouldApply(state: T): boolean;
}

export function createGameStateWriteGuard<
  T extends object,
>(): GameStateWriteGuard<T> {
  let latestSequence = 0;
  const sequenceByState = new WeakMap<T, number>();
  return {
    tag(state) {
      latestSequence += 1;
      sequenceByState.set(state, latestSequence);
      return state;
    },
    shouldApply(state) {
      const tagged = sequenceByState.get(state);
      if (tagged === undefined) return true;
      return tagged >= latestSequence;
    },
  };
}
