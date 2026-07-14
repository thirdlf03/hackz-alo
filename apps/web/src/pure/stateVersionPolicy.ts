import type {GameRenderState} from '@incident/shared';

/**
 * Decides whether a state write is "meaningful" enough to bump
 * GameRenderState.stateVersion. Used to invalidate a prepared AI Assist
 * session (screenshot + stateBlock captured ahead of ask(), see
 * AiAssistPanel.tsx) when the incident state has semantically moved on,
 * instead of relying solely on a fixed 30s age cutoff.
 *
 * Bump-worthy fields: alerts, chat messages, terminal lines/history,
 * metrics, runbook progress, recovery status, and which
 * tool/panel-tab is active — all of these change what an AI Assist answer
 * should say. Deliberately excluded: participantCursor, clickEffects, and
 * other render-only/always-churning fields, which would otherwise
 * invalidate the prepared session on effectively every tick.
 *
 * Reference comparison only (no deep equality): every write site that
 * produces a genuinely new value for one of these fields does so via a new
 * object/array reference (see gameState.ts / gameStateReduce.ts), so `!==`
 * is sufficient and keeps this cheap enough to call on every write.
 */
export function shouldBumpStateVersion(
  prev: GameRenderState,
  next: GameRenderState
): boolean {
  return (
    prev.monitors.left.alerts !== next.monitors.left.alerts ||
    prev.monitors.right.chatMessages !== next.monitors.right.chatMessages ||
    prev.monitors.center.terminal.lines !==
      next.monitors.center.terminal.lines ||
    prev.monitors.center.terminal.commandHistory !==
      next.monitors.center.terminal.commandHistory ||
    prev.monitors.left.metrics !== next.monitors.left.metrics ||
    prev.runbookProgress !== next.runbookProgress ||
    prev.recovery !== next.recovery ||
    prev.monitors.center.activeTool !== next.monitors.center.activeTool ||
    prev.monitors.right.activePanelTab !== next.monitors.right.activePanelTab
  );
}

/**
 * Returns `next` with `stateVersion` advanced from `prev` iff
 * shouldBumpStateVersion reports a meaningful change; otherwise carries
 * `prev`'s stateVersion forward unchanged (writes to non-tracked fields,
 * e.g. participantCursor, never invalidate a prepared AI Assist session).
 * Returns `next` as-is (no new object) when the resulting stateVersion is
 * already what `next` has, to avoid an unnecessary allocation on the common
 * "no bump" path.
 */
export function withStateVersion<T extends GameRenderState>(
  prev: GameRenderState,
  next: T
): T {
  const stateVersion = shouldBumpStateVersion(prev, next)
    ? (prev.stateVersion ?? 0) + 1
    : prev.stateVersion;
  if (next.stateVersion === stateVersion) return next;
  return {...next, stateVersion};
}
