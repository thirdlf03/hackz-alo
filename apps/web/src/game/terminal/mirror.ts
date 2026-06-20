import type { Terminal } from "@xterm/xterm";
import type { TerminalMirrorState } from "@incident/shared";

export function createEmptyTerminalMirror(cols = 80, rows = 24): TerminalMirrorState {
  return {
    cols,
    rows,
    lines: ["sandbox に接続しています..."],
    cursor: { x: 0, y: 0, visible: true },
    commandDraft: "",
    commandHistory: []
  };
}

export function terminalToMirrorState(
  terminal: Terminal,
  commandHistory: TerminalMirrorState["commandHistory"] = []
): TerminalMirrorState {
  const buffer = terminal.buffer.active;
  const viewportY = buffer.viewportY;
  const lines: string[] = [];
  const cursorLineIndex = viewportY + buffer.cursorY;

  for (let row = 0; row < terminal.rows; row += 1) {
    const index = viewportY + row;
    const line = buffer.getLine(index);
    const isCursorLine = index === cursorLineIndex;
    const preserveUntilColumn =
      line && isCursorLine && !shouldIgnoreWrappedBlankCursorPadding(line, isCursorLine)
        ? buffer.cursorX
        : undefined;
    const text = line
      ? mirrorLineText(line, preserveUntilColumn)
      : "";
    lines.push(text);
  }

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    lines: lines.length > 0 ? lines : [""],
    cursor: {
      x: buffer.cursorX,
      y: buffer.cursorY,
      visible: true
    },
    commandDraft: commandDraftAtCursor(buffer, cursorLineIndex, buffer.cursorX),
    commandHistory: commandHistory.map((item) => ({ ...item }))
  };
}

function mirrorLineText(line: NonNullable<ReturnType<Terminal["buffer"]["active"]["getLine"]>>, preserveUntilColumn?: number) {
  const trimmed = line.translateToString(true);
  if (preserveUntilColumn === undefined || trimmed.length >= preserveUntilColumn) return trimmed;
  return line.translateToString(false).slice(0, preserveUntilColumn);
}

function shouldIgnoreWrappedBlankCursorPadding(
  line: NonNullable<ReturnType<Terminal["buffer"]["active"]["getLine"]>>,
  isCursorLine: boolean
) {
  return isCursorLine && line.isWrapped && line.translateToString(true) === "";
}

function commandDraftAtCursor(
  buffer: Terminal["buffer"]["active"],
  cursorLineIndex: number,
  cursorColumn: number
) {
  let startLineIndex = cursorLineIndex;
  while (startLineIndex > 0 && buffer.getLine(startLineIndex)?.isWrapped) {
    startLineIndex -= 1;
  }

  const parts: string[] = [];
  for (let index = startLineIndex; index <= cursorLineIndex; index += 1) {
    const line = buffer.getLine(index);
    if (!line) continue;
    if (shouldIgnoreWrappedBlankCursorPadding(line, index === cursorLineIndex)) continue;
    parts.push(mirrorLineText(line, index === cursorLineIndex ? cursorColumn : undefined));
  }
  return parts.join("");
}
