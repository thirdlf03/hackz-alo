import {useEffect, useRef} from 'preact/hooks';
import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {
  deactivateChatCompose,
  focusCommandInput,
  setChatDraft,
} from '../game/state/gameState.js';
import {
  defaultTerminalDimensions,
  expandedTerminalDimensions,
} from '../game/terminal/layout.js';
import {TerminalSession} from '../game/terminal/session.js';
import {terminalDebug} from '../game/terminal/debug.js';
import {keyboardEventToTerminalInput} from '../game/terminal/input.js';
import {
  classifyCommandEvent,
  commandEventPayload,
  type ReplayEventEmitter,
} from '../game/events/emitReplayEvent.js';
import type {ApiClientSurface} from '../api/client.js';
import type {Screen} from './appTypes.js';

interface SessionIdentity {
  sessionId: string;
  replayId: string;
}
interface MutableRef<T> {
  current: T;
}
type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

const DANGEROUS_COMMAND = /\brm\s+-rf\b/i;

export function useTerminalBridge(options: {
  api: ApiClientSurface;
  screen: Screen;
  gameState: GameRenderState | undefined;
  gameStateRef: MutableRef<GameRenderState | undefined>;
  sessionRef: MutableRef<SessionIdentity | undefined>;
  scenarioRef: MutableRef<ScenarioDefinition | undefined>;
  eventEmitterRef: MutableRef<ReplayEventEmitter | null>;
  patchGameStateRef: PatchGameState;
  currentGameTimeMs: () => number;
  submitChatMessage: () => void;
}) {
  const terminalRef = useRef<TerminalSession | null>(null);
  const attachedSessionIdRef = useRef<string | undefined>(undefined);

  function destroyTerminal() {
    terminalRef.current?.destroy();
    terminalRef.current = null;
    attachedSessionIdRef.current = undefined;
  }

  async function attachTerminalSession(activeSession: SessionIdentity) {
    if (attachedSessionIdRef.current === activeSession.sessionId) {
      // Already connected for this session, or an attach for this session
      // is already in flight (e.g. the host attached via startPlay and the
      // guest phase-sync effect also fired). attachedSessionIdRef is set
      // synchronously below — before any await — so this guard also
      // covers re-entrant calls that land while the earlier attach is
      // still awaiting resizeTerminal/connect. No-op either way.
      return;
    }
    destroyTerminal();
    // Mark this session as in-flight immediately (before the first await)
    // so a re-entrant call for the same session hits the guard above
    // instead of racing to attach twice. Reset to undefined on failure so
    // a later retry isn't permanently blocked.
    attachedSessionIdRef.current = activeSession.sessionId;
    try {
      const {cols, rows} = defaultTerminalDimensions();
      await options.api.resizeTerminal(activeSession.sessionId, cols, rows);
      const terminal = new TerminalSession({
        sessionId: activeSession.sessionId,
        accessToken: options.api.sessionAccessToken(),
        cols,
        rows,
        onResize: (nextCols, nextRows) => {
          void options.api
            .resizeTerminal(activeSession.sessionId, nextCols, nextRows)
            .catch(console.error);
        },
        onSnapshot: (snapshot) => {
          options.patchGameStateRef((current) => ({
            ...current,
            monitors: {
              ...current.monitors,
              center: {...current.monitors.center, terminal: snapshot},
            },
          }));
        },
        onOutput: (summary) => {
          const replayId = options.sessionRef.current?.replayId;
          const emitter = options.eventEmitterRef.current;
          if (!replayId || !emitter || !summary.trim()) return;
          void emitter.emit({
            replayId,
            type: 'terminal_output',
            at: options.currentGameTimeMs(),
            actor: 'sandbox',
            payload: {data: summary},
          });
        },
        onCommand: (command) => {
          const replayId = options.sessionRef.current?.replayId;
          const emitter = options.eventEmitterRef.current;
          if (!replayId || !emitter) return;
          const at = options.currentGameTimeMs();
          if (
            DANGEROUS_COMMAND.test(command) &&
            options.scenarioRef.current?.difficulty === 'beginner'
          ) {
            options.patchGameStateRef((current) => ({
              ...current,
              warning: {
                message:
                  '危険: rm -rf は本番では慎重に。Runbook を確認してください。',
                flashMs: 4000,
              },
            }));
          }
          void emitter.emit({
            replayId,
            type: 'terminal_input',
            at,
            payload: {data: `${command}\n`},
            visibility: 'sensitive',
          });
          void emitter.emit({
            replayId,
            type: 'command_detected',
            at,
            payload: {command},
          });
          const special = classifyCommandEvent(command);
          if (special) {
            void emitter.emit({
              replayId,
              type: special,
              at,
              payload: commandEventPayload(command, special),
            });
          }
        },
      });
      terminalRef.current = terminal;
      terminal.connect();
    } catch (error) {
      attachedSessionIdRef.current = undefined;
      throw error;
    }
  }

  function syncTerminalViewport() {
    const terminal = terminalRef.current;
    if (!terminal || options.screen !== 'play') return;
    const expanded = options.gameStateRef.current?.world.expandedMonitor;
    const {cols, rows} =
      expanded === 'terminal'
        ? expandedTerminalDimensions()
        : defaultTerminalDimensions();
    terminal.resize(cols, rows);
  }

  useEffect(
    () => () => {
      destroyTerminal();
    },
    []
  );

  useEffect(() => {
    if (options.screen !== 'play') return;
    syncTerminalViewport();
  }, [options.screen, options.gameState?.world.expandedMonitor]);

  function handleCanvasPaste(event: ClipboardEvent) {
    const clipboard = event.clipboardData;
    if (!clipboard || !terminalRef.current) return;
    const text = clipboard.getData('text/plain');
    if (text) {
      event.preventDefault();
      terminalRef.current.input(text);
    }
  }

  function handleTerminalKey(event: KeyboardEvent) {
    if (options.screen !== 'play') return;
    if (options.gameStateRef.current?.monitors.center.activeTool === 'editor') {
      return;
    }
    if (options.gameStateRef.current?.chatCompose.active) {
      if (event.key === 'Escape') {
        event.preventDefault();
        options.patchGameStateRef((current) => deactivateChatCompose(current));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        options.submitChatMessage();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        options.patchGameStateRef((current) =>
          setChatDraft(current, current.chatCompose.draft.slice(0, -1))
        );
        return;
      }
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        options.patchGameStateRef((current) =>
          setChatDraft(current, `${current.chatCompose.draft}${event.key}`)
        );
      }
      return;
    }
    if (!terminalRef.current) return;
    if (!options.gameStateRef.current?.commandInputFocused) {
      options.patchGameStateRef((current) => focusCommandInput(current));
    }
    const input = keyboardEventToTerminalInput(event);
    if (!input) return;
    event.preventDefault();
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      terminalDebug('keydown.ctrl-c', {interruptOnly: true});
      const activeSession = options.sessionRef.current;
      if (activeSession) {
        void options.api
          .interruptTerminal(activeSession.sessionId)
          .catch(() => {});
      }
      return;
    }
    if (terminalRef.current.getConnectionState() !== 'connected') return;
    terminalRef.current.input(input);
  }

  return {
    attachTerminalSession,
    destroyTerminal,
    handleCanvasPaste,
    handleTerminalKey,
  };
}
