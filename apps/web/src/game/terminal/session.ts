import { SandboxAddon } from "@cloudflare/sandbox/xterm";
import { Terminal } from "@xterm/xterm";
import type { TerminalMirrorState } from "@incident/shared";
import { terminalToMirrorState } from "./mirror.js";

export type TerminalConnectionState = "disconnected" | "connecting" | "connected";

export type TerminalSessionOptions = {
  sessionId: string;
  cols?: number;
  rows?: number;
  onSnapshot: (snapshot: TerminalMirrorState) => void;
  onCommand?: (command: string) => void;
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

  constructor(private readonly options: TerminalSessionOptions) {
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 30;

    this.container = document.createElement("div");
    this.container.setAttribute("aria-hidden", "true");
    this.container.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
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
    for (const disposable of this.disposables) disposable.dispose();
    this.terminal.dispose();
    this.container.remove();
  }

  private handleTerminalData(data: string) {
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
    this.options.onSnapshot(this.snapshot());
  }
}
