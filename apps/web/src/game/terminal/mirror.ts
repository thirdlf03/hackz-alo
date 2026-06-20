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
  for (let index = firstVisible; index < lastVisible; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true) : "");
  }

  const currentLine = buffer.getLine(firstVisible + buffer.cursorY);
  const commandDraft = currentLine ? currentLine.translateToString(true) : "";

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    lines: lines.length > 0 ? lines : [""],
    cursor: {
      x: buffer.cursorX,
      y: Math.max(0, Math.min(buffer.cursorY, terminal.rows - 1)),
      visible: true
    },
    commandDraft,
    commandHistory: commandHistory.map((item) => ({ ...item }))
  };
}
