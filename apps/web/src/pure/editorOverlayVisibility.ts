/**
 * Whether the real DOM `<textarea class="editor-overlay">` (PlayScreen.tsx)
 * should be rendered.
 *
 * That textarea is a `position: fixed; z-index: 20` element placed on top
 * of the canvas at the editor panel's screen region — it's how file editing
 * gets a real, accessible text input instead of hand-rolled canvas text
 * editing. The retire-confirm modal, by contrast, is drawn *inside* the
 * canvas bitmap (drawRetireConfirmOverlay) and is only "topmost" from the
 * canvas's own click-resolution point of view (resolveCanvasAction absorbs
 * every canvas click except the modal's own buttons while
 * `recovery.retireConfirming` is true).
 *
 * The editor overlay region (apps/web/src/pure/canvasLayout.ts
 * centerEditorOverlayRegion) overlaps the retire-confirm button rects
 * (retireConfirmButtonRects), so leaving the real textarea mounted while
 * the modal is open put a live, higher-stacked DOM element directly over
 * the confirm/cancel buttons: clicks landed on the textarea instead of
 * reaching the canvas, and the modal became unclickable whenever a user
 * retired with the editor panel open (see tests/e2e/editor.spec.ts, which
 * opens the editor before retiring).
 */
export function shouldShowEditorOverlay(
  activeTool: 'terminal' | 'editor',
  retireConfirming: boolean | undefined
): boolean {
  return activeTool === 'editor' && !retireConfirming;
}
