import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {
  activateChatCompose,
  blurCommandInput,
  deactivateChatCompose,
  dismissNavigationStep,
  focusCommandInput,
  markRunbookStep,
  mergedChatMessages,
  setActiveRunbook,
  setCenterTool,
  setRetireConfirming,
  setRightPanelTab,
  toggleExpandedMonitor,
  toggleNotificationPanel,
} from '../game/state/gameState.js';
import {visibleRunbooks} from '../game/state/gameSelectors.js';
import {
  metricsPanelScrollRegion,
  monitorContentHeight,
  rightPanelLayout,
  type RunbookStepHitRow,
} from '../game/render/canvasLayout.js';
import {
  layoutRunbookBody,
  RUNBOOK_BODY_LINE_HEIGHT,
} from '../game/render/canvasRunbookStepLayout.js';
import {resolveCanvasAction} from '../game/input/canvasActions.js';
import {canContributeRecords, canOperateSandbox} from '../pure/rolePermissions.js';
import {
  hashRunbookBody,
  parseRunbookSteps,
  resolveStepStatuses,
} from '../pure/runbookSteps.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {FinishMode, Screen} from './appTypes.js';
import {containsPoint, toLogicalCanvasPoint} from './appUtils.js';

/**
 * 手順書タブのクリック当たり判定用に、直近の描画と同じ折り返し・Y座標で
 * ステップ行の矩形一覧を求める(canvasRenderRightPanel.ts の描画パスと
 * canvasRunbookStepLayout.ts の layoutRunbookBody を共有し、同じ canvas の
 * 2D context で measureText するため、折り返し位置がずれない)。
 */
function computeRunbookStepHitRows(
  canvas: HTMLCanvasElement | null,
  state: GameRenderState,
  scenario: ScenarioDefinition | undefined
): RunbookStepHitRow[] {
  if (!canvas || state.monitors.right.activePanelTab !== 'runbook') return [];
  const runbook = state.monitors.right.activeRunbook;
  if (!runbook) return [];
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const hasRunbooks = scenario
    ? visibleRunbooks(scenario, state.clock.elapsedMs).length > 0
    : true;
  const bodyTop = rightPanelLayout('runbook', hasRunbooks).contentTop;
  const maxRunbookLines = Math.max(
    10,
    Math.floor(
      (monitorContentHeight - bodyTop - 16) / RUNBOOK_BODY_LINE_HEIGHT
    )
  );
  return layoutRunbookBody(
    ctx,
    runbook,
    state.runbookProgress,
    bodyTop,
    maxRunbookLines
  ).rows.map((row) => ({id: row.id, y: row.y, height: row.height}));
}

export function useCanvasInteraction(options: {
  screen: Screen;
  canvasRef: {current: HTMLCanvasElement | null};
  chatInputRef?: {current: HTMLInputElement | null};
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
  checkRecovery: () => Promise<void>;
  submitChatMessage: () => void;
  loadEditorFiles: () => Promise<void>;
  openEditorFile: (path: string) => Promise<void>;
  onCursorMove?: (point: {x: number; y: number}) => void;
}) {
  const {
    screen,
    canvasRef,
    chatInputRef,
    rendererRef,
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    endSession,
    checkRecovery,
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

      const action = resolveCanvasAction(
        point,
        state,
        scenarioRef.current,
        computeRunbookStepHitRows(canvasRef.current, state, scenarioRef.current)
      );
      if (action.type === 'end_session') {
        return void endSession(action.mode);
      }
      if (action.type === 'recovery_check') {
        return void checkRecovery();
      }
      if (action.type === 'retire_request') {
        patchGameStateRef((current) => setRetireConfirming(current, true));
        return;
      }
      if (action.type === 'retire_confirm') {
        patchGameStateRef((current) => setRetireConfirming(current, false));
        return void endSession('retire');
      }
      if (action.type === 'retire_cancel') {
        patchGameStateRef((current) => setRetireConfirming(current, false));
        return;
      }
      if (action.type === 'focus_command_input') {
        // Mirrors the server-side sandbox role gate: participants who
        // cannot operate the terminal can't focus the command input
        // either (the dock shows the reason instead).
        if (
          !canOperateSandbox(state.room.participants, state.localParticipantId)
        ) {
          return;
        }
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

      if (action.type === 'runbook_step_toggle') {
        // Observer 読み取り専用ゲート。RUNBOOK 進捗の手動更新は
        // task/incident-log と同じ canContributeRecords の対象。
        if (
          !canContributeRecords(state.room.participants, state.localParticipantId)
        ) {
          return;
        }
        const runbook = state.monitors.right.activeRunbook;
        if (!runbook) return;
        const steps = parseRunbookSteps(runbook.body, runbook.steps);
        const resolved = resolveStepStatuses(steps, state.runbookProgress);
        const entry = resolved.find((item) => item.step.id === action.stepId);
        if (!entry) return;
        const bodyHash = hashRunbookBody(runbook.body);
        // 「done ⇄ null」トグル。
        const nextStatus = entry.status === 'done' ? null : 'done';
        patchGameStateRef((current) =>
          markRunbookStep(current, runbook.id, bodyHash, action.stepId, nextStatus)
        );
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
        // HTML-in-Canvas 有効時は本物の <input> が compose 位置に実在するため
        // focus() を移すだけでよい(onFocus が activateChatCompose を呼ぶ)。
        // 非対応時は従来の疑似フォーカス状態を立てる。
        const embedded = chatInputRef?.current;
        if (embedded) {
          embedded.focus();
        } else {
          patchGameStateRef((current) => activateChatCompose(current));
        }
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
