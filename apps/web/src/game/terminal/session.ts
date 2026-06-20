import { SandboxAddon } from "@cloudflare/sandbox/xterm";
import { Terminal } from "@xterm/xterm";
import type { TerminalMirrorState } from "@incident/shared";
import { installTerminalWebSocketDebug, terminalDebug } from "./debug.js";
import { terminalToMirrorState } from "./mirror.js";

export type TerminalConnectionState = "disconnected" | "connecting" | "connected";

export type TerminalSessionOptions = {
  sessionId: string;
  cols?: number;
  rows?: number;
  onSnapshot: (snapshot: TerminalMirrorState) => void;
  onCommand?: (command: string) => void;
  onOutput?: (summary: string) => void;
  onConnectionChange?: (state: TerminalConnectionState, error?: Error) => void;
};

export class TerminalSession {
  private readonly terminal: Terminal;
  private readonly addon: SandboxAddon;
  private readonly container: HTMLDivElement;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly commandHistory: TerminalMirrorState["commandHistory"] = [];
  private inputBuffer = "";
  private connectionState: TerminalConnectionState = "disconnected";
  private snapshotFrame = 0;
  private lastOutputLine = "";

  constructor(private readonly options: TerminalSessionOptions) {
    installTerminalWebSocketDebug();
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 30;

    this.container = document.createElement("div");
    this.container.setAttribute("aria-hidden", "true");
    this.container.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;visibility:hidden;pointer-events:none;z-index:-1;";
    document.body.appendChild(this.container);

    this.terminal = new Terminal({
      cols,
      rows,
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 14,
      theme: {
        background: "#05070a",
        foreground: "#d1fae5",
        cursor: "#d1fae5"
      }
    });

    this.addon = new SandboxAddon({
      reconnect: true,
      getWebSocketUrl: ({ origin }) =>
        `${origin}/api/sessions/${encodeURIComponent(options.sessionId)}/ws/terminal`,
      onStateChange: (state, error) => {
        this.connectionState = state;
        terminalDebug("connection", {
          state,
          error: error?.message
        });
        options.onConnectionChange?.(state, error);
        if (state === "connected") this.publishSnapshot();
      }
    });

    this.terminal.loadAddon(this.addon);
    this.terminal.open(this.container);
    this.publishSnapshot();

    this.disposables.push(
      this.terminal.onWriteParsed(() => this.publishSnapshot()),
      this.terminal.onCursorMove(() => this.publishSnapshot()),
      this.terminal.onLineFeed(() => this.publishSnapshot()),
      this.terminal.onData((data) => this.handleTerminalData(data))
    );
  }

  connect() {
    this.addon.connect({
      sandboxId: `session-${this.options.sessionId}`,
      sessionId: this.options.sessionId
    });
  }

  disconnect() {
    this.addon.disconnect();
  }

  input(data: string) {
    terminalDebug("session.input", {
      bytes: [...data].map((char) => char.charCodeAt(0)),
      connection: this.connectionState,
      sigint: data.includes("\u0003")
    });
    this.terminal.input(data);
  }

  snapshot(): TerminalMirrorState {
    return terminalToMirrorState(this.terminal, this.commandHistory);
  }

  getConnectionState() {
    return this.connectionState;
  }

  destroy() {
    this.disconnect();
    if (this.snapshotFrame) {
      cancelAnimationFrame(this.snapshotFrame);
      this.snapshotFrame = 0;
    }
    for (const disposable of this.disposables) disposable.dispose();
    this.terminal.dispose();
    this.container.remove();
  }

  private handleTerminalData(data: string) {
    if (data.includes("\u0003")) {
      terminalDebug("xterm.onData", {
        bytes: [...data].map((char) => char.charCodeAt(0)),
        connection: this.connectionState
      });
    }
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        const command = this.inputBuffer.trim();
        this.inputBuffer = "";
        if (command) {
          this.commandHistory.push({ at: Date.now(), command });
          this.options.onCommand?.(command);
        }
        continue;
      }
      if (char === "\u007f") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        continue;
      }
      if (char >= " " || char === "\t") {
        this.inputBuffer += char;
      }
    }
    this.publishSnapshot();
  }

  private publishSnapshot() {
    if (this.snapshotFrame) return;
    this.snapshotFrame = requestAnimationFrame(() => {
      this.snapshotFrame = 0;
      const snapshot = this.snapshot();
      const lastLine = snapshot.lines.at(-1) ?? "";
      if (lastLine && lastLine !== this.lastOutputLine) {
        this.lastOutputLine = lastLine;
        this.options.onOutput?.(lastLine.slice(0, 120));
      }
      this.options.onSnapshot(snapshot);
    });
  }
}
