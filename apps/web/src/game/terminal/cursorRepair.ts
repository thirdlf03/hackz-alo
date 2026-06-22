/**
 * readline tab-completion redraw sometimes leaves xterm's cursor at column 0
 * even though the prompt line text is correct. Repair only when the cursor is
 * still inside the prompt prefix and typed input exists after "# ".
 */
export function tabCompletionCursorColumn(
  cursorX: number,
  lineText: string
): number | null {
  const trimmed = lineText.trimEnd();
  const promptEnd = trimmed.lastIndexOf('# ');
  if (promptEnd < 0) return null;

  const targetX = trimmed.length;
  const typedStart = promptEnd + 2;
  if (targetX <= typedStart) return null;
  if (cursorX >= targetX) return null;
  if (cursorX > promptEnd + 1) return null;
  return targetX;
}
