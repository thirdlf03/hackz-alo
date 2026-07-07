import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {
  activateChatCompose,
  blurCommandInput,
  deactivateChatCompose,
  dismissNavigationStep,
  focusCommandInput,
  mergedChatMessages,
  setActiveRunbook,
  setCenterTool,
  setRightPanelTab,
  toggleExpandedMonitor,
  toggleNotificationPanel,
} from '../game/state/gameState.js';
import {metricsPanelScrollRegion} from '../game/render/canvasLayout.js';
import {resolveCanvasAction} from '../game/input/canvasActions.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {FinishMode, Screen} from './AppScreens.js';
import {containsPoint, toLogicalCanvasPoint} from './appUtils.js';

export function useCanvasInteraction(options: {
  screen: Screen;
  canvasRef: {current: HTMLCanvasElement | null};
  rendererRef: {current: {scrollMetricsPanel(deltaY: number): void} | null};
  gameStateRef: {current: GameRenderState | undefined};
  sessionRef: {current: {sessionId: string; replayId: string} | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
  eventEmitterRef: {current: ReplayEventEmitter | null};
  patchGameStateRef: (
    updater: (state: GameRenderState) => GameRenderState,
    patchOptions?: {render?: boolean; collectTransitions?: boolean}
  ) => void;
  currentGameTimeMs: () => number;
  endSession: (mode: FinishMode) => Promise<void>;
  submitChatMessage: () => void;
  loadEditorFiles: () => Promise<void>;
  openEditorFile: (path: string) => Promise<void>;
  onCursorMove?: (point: {x: number; y: number}) => void;
}) {
  const {
    screen,
    canvasRef,
    rendererRef,
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    endSession,
    submitChatMessage,
    loadEditorFiles,
    openEditorFile,
    onCursorMove,
  } = options;

  function handleCanvasClick(event: MouseEvent) {
    if (!canvasRef.current) return;
    canvasRef.current.focus();
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    const replayId = sessionRef.current?.replayId;
    const emitter = eventEmitterRef.current;
    if (screen === 'play' && replayId && emitter) {
      const at = currentGameTimeMs();
      const state = gameStateRef.current;
      if (!state) return;
      void emitter.emit({
        replayId,
        type: 'ui_click',
        at,
        payload: {x: point.x, y: point.y},
      });

      const action = resolveCanvasAction(point, state, scenarioRef.current);
      if (action.type === 'end_session') {
        return void endSession(action.mode);
      }
      if (action.type === 'focus_command_input') {
        patchGameStateRef((current) =>
          focusCommandInput(deactivateChatCompose(current))
        );
        return;
      }
      patchGameStateRef((current) => blurCommandInput(current));

      if (action.type === 'center_tool') {
        patchGameStateRef((current) => setCenterTool(current, action.tool));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: action.tool},
        });
        if (action.tool === 'editor') void loadEditorFiles();
        return;
      }

      if (action.type === 'open_editor_file') {
        patchGameStateRef((current) => setCenterTool(current, 'editor'));
        void openEditorFile(action.path);
        return;
      }

      if (action.type === 'right_panel_tab') {
        patchGameStateRef((current) => setRightPanelTab(current, action.tab));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: action.tab === 'chat' ? 'chat' : 'runbook'},
        });
        return;
      }

      if (action.type === 'runbook_tab') {
        const activeScenario = scenarioRef.current;
        if (!activeScenario) return;
        patchGameStateRef((current) =>
          setActiveRunbook(current, activeScenario, action.index)
        );
        void emitter.emitOnce(`runbook:${action.runbookId}`, {
          replayId,
          type: 'runbook_open',
          at,
          payload: {runbookId: action.runbookId},
        });
        return;
      }

      if (action.type === 'notification_bell') {
        const unreadAlerts = state.monitors.left.alerts.filter(
          (alert) => !state.notifications.readAlertIds.includes(alert.id)
        );
        const unreadChat = mergedChatMessages(state).filter(
          (message) => !state.seenChatIds.includes(message.id)
        );
        patchGameStateRef((current) => toggleNotificationPanel(current));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: 'notifications'},
        });
        for (const alert of unreadAlerts) {
          void emitter.emitOnce(`chat-read:${alert.id}`, {
            replayId,
            type: 'chat_message_read',
            at,
            payload: {alertId: alert.id, message: alert.message},
          });
        }
        for (const message of unreadChat) {
          void emitter.emitOnce(`chat-read:${message.id}`, {
            replayId,
            type: 'chat_message_read',
            at,
            payload: {
              messageId: message.id,
              from: message.from,
              body: message.body,
            },
          });
        }
        return;
      }

      if (action.type === 'dismiss_navigation') {
        patchGameStateRef((current) =>
          dismissNavigationStep(current, action.stepId)
        );
        return;
      }

      if (action.type === 'close_expanded_monitor') {
        patchGameStateRef((current) => ({
          ...current,
          world: {...current.world, expandedMonitor: null},
        }));
        return;
      }

      if (action.type === 'toggle_expanded_monitor') {
        patchGameStateRef((current) =>
          toggleExpandedMonitor(current, action.monitor)
        );
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: `monitor.${action.monitor}`},
        });
        return;
      }

      if (action.type === 'chat_send') {
        submitChatMessage();
        return;
      }

      if (action.type === 'chat_compose') {
        patchGameStateRef((current) => activateChatCompose(current));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: 'chat_compose'},
        });
        return;
      }

      if (action.type === 'deactivate_chat_compose') {
        patchGameStateRef((current) => deactivateChatCompose(current));
      }
    }
  }

  function handleCanvasMove(event: MouseEvent) {
    if (!canvasRef.current || screen !== 'play') return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    onCursorMove?.(point);
    patchGameStateRef(
      (current) => {
        const cursor = current.cursor;
        if (
          Math.abs(cursor.x - point.x) < 1 &&
          Math.abs(cursor.y - point.y) < 1 &&
          cursor.visible
        ) {
          return current;
        }
        return {...current, cursor: {x: point.x, y: point.y, visible: true}};
      },
      {render: true, collectTransitions: false}
    );
  }

  function handleCanvasWheel(event: WheelEvent) {
    if (!canvasRef.current || screen !== 'play') return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    const expandedMonitor = gameStateRef.current?.world.expandedMonitor;
    if (expandedMonitor && expandedMonitor !== 'metrics') return;
    if (
      !containsPoint(
        metricsPanelScrollRegion(expandedMonitor === 'metrics'),
        point.x,
        point.y
      )
    ) {
      return;
    }

    event.preventDefault();
    rendererRef.current?.scrollMetricsPanel(event.deltaY);
  }

  return {
    handleCanvasClick,
    handleCanvasMove,
    handleCanvasWheel,
  };
}
