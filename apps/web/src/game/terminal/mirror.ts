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
  let commandDraft = "";

  for (let row = 0; row < terminal.rows; row += 1) {
    const index = viewportY + row;
    const line = buffer.getLine(index);
    const isCursorLine = index === cursorLineIndex;
    const text = line
      ? mirrorLineText(line, isCursorLine ? buffer.cursorX : undefined)
      : "";
    if (isCursorLine) commandDraft = text;
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
    commandDraft,
    commandHistory: commandHistory.map((item) => ({ ...item }))
  };
}

function mirrorLineText(line: NonNullable<ReturnType<Terminal["buffer"]["active"]["getLine"]>>, preserveUntilColumn?: number) {
  const trimmed = line.translateToString(true);
  if (preserveUntilColumn === undefined || trimmed.length >= preserveUntilColumn) return trimmed;
  return line.translateToString(false).slice(0, preserveUntilColumn);
}
