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
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true) : "");
  }

  const firstVisible = Math.max(0, buffer.length - terminal.rows);
  const visibleLines = lines.slice(firstVisible);
  const relativeCursorY = buffer.cursorY - firstVisible;
  const currentLine = buffer.getLine(buffer.cursorY);
  const commandDraft = currentLine ? currentLine.translateToString(true) : "";

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    lines: visibleLines.length > 0 ? visibleLines : [""],
    cursor: {
      x: buffer.cursorX,
      y: Math.max(0, Math.min(relativeCursorY, terminal.rows - 1)),
      visible: true
    },
    commandDraft,
    commandHistory: commandHistory.map((item) => ({ ...item }))
  };
}
