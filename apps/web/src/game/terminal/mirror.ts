import type { Terminal } from "@xterm/xterm";
import type { TerminalMirrorState } from "@incident/shared";

export function createEmptyTerminalMirror(cols = 100, rows = 30): TerminalMirrorState {
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
  const lines: string[] = [];
  const firstVisible = Math.max(0, buffer.baseY);
  const lastVisible = Math.min(buffer.length, firstVisible + terminal.rows);
  const cursorY = Math.max(0, Math.min(buffer.cursorY, terminal.rows - 1));
  const cursorLineIndex = firstVisible + cursorY;
  let commandDraft = "";
  for (let index = firstVisible; index < lastVisible; index += 1) {
    const line = buffer.getLine(index);
    const text = line
      ? mirrorLineText(line, index === cursorLineIndex ? buffer.cursorX : undefined)
      : "";
    if (index === cursorLineIndex) commandDraft = text;
    lines.push(text);
  }

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    lines: lines.length > 0 ? lines : [""],
    cursor: {
      x: buffer.cursorX,
      y: cursorY,
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
