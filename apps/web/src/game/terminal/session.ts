import {SandboxAddon} from '@cloudflare/sandbox/xterm';
import {Terminal} from '@xterm/xterm';
import type {TerminalMirrorState} from '@incident/shared';
import {gamePalette} from '../render/gamePalette.js';
import {tabCompletionCursorColumn} from './cursorRepair.js';
import {installTerminalWebSocketDebug, terminalDebug} from './debug.js';
import {
  defaultTerminalDimensions,
  measureTerminalCellWidth,
  terminalLineHeight,
} from './layout.js';
import {terminalToMirrorState} from './mirror.js';

export type TerminalConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface TerminalSessionOptions {
  sessionId: string;
  accessToken?: string | undefined;
  cols?: number;
  rows?: number;
  onSnapshot: (snapshot: TerminalMirrorState) => void;
  onCommand?: (command: string) => void;
  onOutput?: (summary: string) => void;
  onConnectionChange?: (state: TerminalConnectionState, error?: Error) => void;
  onResize?: (cols: number, rows: number) => void;
}

export class TerminalSession {
  private readonly terminal: Terminal;
  private readonly addon: SandboxAddon;
  private readonly container: HTMLDivElement;
  private readonly disposables: Array<{dispose: () => void}> = [];
  private readonly commandHistory: TerminalMirrorState['commandHistory'] = [];
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private inputBuffer = '';
  private connectionState: TerminalConnectionState = 'disconnected';
  private snapshotFrame = 0;
  private lastOutputLine = '';
  private tabCompletionExpiresAt = 0;
  private suppressLocalWrite = false;
  private readonly ptyResizeTimers: number[] = [];

  constructor(private readonly options: TerminalSessionOptions) {
    installTerminalWebSocketDebug();
    const defaults = defaultTerminalDimensions();
    const cols = options.cols ?? defaults.cols;
    const rows = options.rows ?? defaults.rows;
    this.cellWidth = measureTerminalCellWidth();
    this.cellHeight = terminalLineHeight;

    this.container = document.createElement('div');
    this.container.setAttribute('aria-hidden', 'true');
    this.container.style.cssText = `position:fixed;left:-10000px;top:0;width:${String(cols * this.cellWidth)}px;height:${String(rows * this.cellHeight)}px;overflow:hidden;opacity:0;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(this.container);

    this.terminal = new Terminal({
      cols,
      rows,
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 18,
      lineHeight: 1.22,
      letterSpacing: 0,
      theme: {
        background: gamePalette.bgTerminal,
        foreground: gamePalette.textTerminal,
        cursor: gamePalette.textTerminal,
      },
    });

    this.addon = new SandboxAddon({
      reconnect: true,
      getWebSocketUrl: ({origin}) => {
        const url = new URL(
          `${origin}/api/sessions/${encodeURIComponent(options.sessionId)}/ws/terminal`
        );
        if (options.accessToken) {
          url.searchParams.set('accessToken', options.accessToken);
        }
        return url.toString();
      },
      onStateChange: (state, error) => {
        this.connectionState = state;
        terminalDebug('connection', {
          state,
          error: error?.message,
        });
        options.onConnectionChange?.(state, error);
        if (state === 'connected') {
          this.schedulePtyResizeSync();
          options.onResize?.(this.terminal.cols, this.terminal.rows);
          this.publishSnapshot();
        }
      },
    });

    this.terminal.loadAddon(this.addon);
    this.terminal.open(this.container);
    this.publishSnapshot();

    this.disposables.push(
      this.terminal.onWriteParsed(() => {
        this.handleWriteParsed();
      }),
      this.terminal.onLineFeed(() => {
        this.publishSnapshot();
      }),
      this.terminal.onData((data) => {
        this.handleTerminalData(data);
      })
    );
  }

  connect() {
    this.addon.connect({
      sandboxId: `session-${this.options.sessionId}`,
      sessionId: this.options.sessionId,
    });
  }

  disconnect() {
    this.addon.disconnect();
  }

  input(data: string) {
    if (this.connectionState !== 'connected') return;
    if (data.includes('\t')) {
      this.tabCompletionExpiresAt = Date.now() + 500;
    }
    terminalDebug('session.input', {
      bytes: Array.from(data, (char) => char.charCodeAt(0)),
      connection: this.connectionState,
      sigint: data.includes('\u0003'),
    });
    this.terminal.input(data);
  }

  resize(cols: number, rows: number) {
    if (cols < 12 || rows < 10) return;
    if (this.terminal.cols === cols && this.terminal.rows === rows) return;
    this.terminal.resize(cols, rows);
    this.container.style.width = `${String(cols * this.cellWidth)}px`;
    this.container.style.height = `${String(rows * this.cellHeight)}px`;
    this.options.onResize?.(cols, rows);
    this.publishSnapshot();
  }

  snapshot(): TerminalMirrorState {
    return terminalToMirrorState(this.terminal, this.commandHistory);
  }

  getConnectionState() {
    return this.connectionState;
  }

  destroy() {
    this.disconnect();
    for (const timer of this.ptyResizeTimers) window.clearTimeout(timer);
    this.ptyResizeTimers.length = 0;
    if (this.snapshotFrame) {
      cancelAnimationFrame(this.snapshotFrame);
      this.snapshotFrame = 0;
    }
    for (const disposable of this.disposables) disposable.dispose();
    this.terminal.dispose();
    this.container.remove();
  }

  private handleTerminalData(data: string) {
    if (data.includes('\u0003')) {
      terminalDebug('xterm.onData', {
        bytes: Array.from(data, (char) => char.charCodeAt(0)),
        connection: this.connectionState,
      });
    }
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const command = this.inputBuffer.trim();
        this.inputBuffer = '';
        if (command) {
          this.commandHistory.push({at: Date.now(), command});
          this.options.onCommand?.(command);
        }
        continue;
      }
      if (char === '\u007f') {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        continue;
      }
      if (char >= ' ' || char === '\t') {
        this.inputBuffer += char;
      }
    }
    this.publishSnapshot();
  }

  private handleWriteParsed() {
    if (this.suppressLocalWrite) {
      this.suppressLocalWrite = false;
      this.publishSnapshot();
      return;
    }
    if (Date.now() < this.tabCompletionExpiresAt) {
      this.repairTabCompletionCursor();
    }
    this.publishSnapshot();
  }

  private repairTabCompletionCursor() {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(buffer.viewportY + buffer.cursorY);
    if (!line) return;

    const targetX = tabCompletionCursorColumn(
      buffer.cursorX,
      line.translateToString(true)
    );
    if (targetX === null) return;

    terminalDebug('cursor.repair.tab', {from: buffer.cursorX, to: targetX});
    this.suppressLocalWrite = true;
    this.terminal.write(`\x1b[${String(targetX + 1)}G`);
  }

  private schedulePtyResizeSync() {
    this.flushPtyResize();
    for (const delay of [100, 300]) {
      this.ptyResizeTimers.push(
        window.setTimeout(() => {
          if (this.connectionState === 'connected') this.flushPtyResize();
        }, delay)
      );
    }
  }

  private flushPtyResize() {
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    if (cols < 13 || rows < 11) return;
    this.terminal.resize(cols - 1, rows);
    this.terminal.resize(cols, rows);
  }

  private publishSnapshot() {
    if (this.snapshotFrame) return;
    this.snapshotFrame = requestAnimationFrame(() => {
      this.snapshotFrame = 0;
      const snapshot = this.snapshot();
      const lastLine = snapshot.lines.at(-1) ?? '';
      if (lastLine && lastLine !== this.lastOutputLine) {
        this.lastOutputLine = lastLine;
        this.options.onOutput?.(lastLine.slice(0, 120));
      }
      this.options.onSnapshot(snapshot);
    });
  }
}
