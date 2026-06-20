import type { TerminalMirrorState } from "@incident/shared";

export class TerminalMirror {
  private state: TerminalMirrorState;

  constructor(cols: number, rows: number) {
    this.state = {
      cols,
      rows,
      lines: ["$ curl localhost:8080/health", "{\"ok\":true}", "$ "],
      cursor: { x: 2, y: 2, visible: true },
      commandDraft: "",
      commandHistory: []
    };
  }

  input(text: string) {
    const normalized = text.replace(/\r/g, "");
    const commands = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

    for (const command of commands) {
      this.state.commandDraft = "";
      this.state.commandHistory.push({ at: Date.now(), command });
      this.write(`$ ${command}`);
      this.write(this.simulateOutput(command));
    }

    this.write("$ ");
  }

  write(text: string) {
    const appended = text.split("\n").flatMap((line) => this.wrapLine(line));
    this.state.lines = [...this.state.lines, ...appended].slice(-this.state.rows);
    const last = this.state.lines[this.state.lines.length - 1] ?? "";
    this.state.cursor = {
      x: Math.min(last.length, this.state.cols - 1),
      y: Math.min(this.state.lines.length - 1, this.state.rows - 1),
      visible: true
    };
  }

  snapshot(): TerminalMirrorState {
    return {
      ...this.state,
      cursor: { ...this.state.cursor },
      lines: [...this.state.lines],
      commandHistory: this.state.commandHistory.map((item) => ({ ...item }))
    };
  }

  private wrapLine(line: string) {
    if (line.length <= this.state.cols) return [line];
    const wrapped: string[] = [];
    for (let index = 0; index < line.length; index += this.state.cols) {
      wrapped.push(line.slice(index, index + this.state.cols));
    }
    return wrapped;
  }

  private simulateOutput(command: string) {
    if (command.includes("df")) return "Filesystem      Size Used Avail Use% Mounted on\nworkspace        1G  970M  54M  95% /workspace";
    if (command.includes("ps")) return "unyoh-api  231  node /workspace/services/unyoh-api/server.mjs";
    if (command.includes("tail")) return "2026-06-20T03:00:00Z critical: HTTP 500 rate is above threshold";
    if (command.includes("unlang")) return "うんともすんとも";
    if (command.includes("curl")) return "{\"ok\":false,\"reason\":\"scenario fault active\"}";
    if (command.includes("unctl restart")) return "api restarted";
    return "ok";
  }
}
