/**
 * Deterministic palette-index assignment for a participant's cursor color,
 * derived from participantId so the color stays stable for that participant
 * across reconnects/rejoins regardless of join order or where they land in
 * the participants array (see canvasRenderChrome.ts drawParticipantCursors,
 * which previously used `index % colors.length` and reassigned colors
 * whenever the online participant list shifted).
 */
export function participantColorIndex(
  participantId: string,
  paletteSize: number
): number {
  if (paletteSize <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < participantId.length; i++) {
    hash = (hash * 31 + participantId.charCodeAt(i)) >>> 0;
  }
  return hash % paletteSize;
}
