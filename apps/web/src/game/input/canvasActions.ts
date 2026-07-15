import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {visibleRunbooks} from '../state/gameSelectors.js';
import {
  centerToolAt,
  containsCanvasPoint,
  expandedMonitorLayout,
  inputDockRects,
  monitorContentRegion,
  monitorContentWidth,
  monitorContentHeight,
  monitorHeaderHeight,
  monitorLayout,
  monitorMagnifyAt,
  notificationBellRegion,
  retireConfirmButtonRects,
  rightPanelPrimaryTabAt,
  runbookTabAt,
  chatComposeAt,
  type MonitorId,
  type RightPanelTab,
} from '../render/canvasLayout.js';

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasAction =
  | {type: 'end_session'; mode: 'resolve' | 'retire'}
  | {type: 'recovery_check'}
  | {type: 'retire_request'}
  | {type: 'retire_confirm'}
  | {type: 'retire_cancel'}
  | {type: 'focus_command_input'}
  | {type: 'center_tool'; tool: 'terminal' | 'editor'}
  | {type: 'open_editor_file'; path: string}
  | {type: 'right_panel_tab'; tab: RightPanelTab}
  | {type: 'runbook_tab'; index: number; runbookId: string}
  | {type: 'notification_bell'}
  | {type: 'dismiss_navigation'; stepId: string}
  | {type: 'close_expanded_monitor'}
  | {type: 'toggle_expanded_monitor'; monitor: MonitorId}
  | {type: 'chat_send'}
  | {type: 'chat_compose'}
  | {type: 'deactivate_chat_compose'}
  | {type: 'none'; absorb?: boolean};

export function resolveCanvasAction(
  point: CanvasPoint,
  state: GameRenderState,
  scenario?: ScenarioDefinition
): CanvasAction {
  // The retire confirmation modal is topmost while open: it absorbs every
  // click except its own two buttons, so nothing behind it (input dock,
  // panels, ...) can be triggered accidentally on a destructive action.
  if (state.recovery?.retireConfirming) {
    if (
      containsCanvasPoint(retireConfirmButtonRects.confirm, point.x, point.y)
    ) {
      return {type: 'retire_confirm'};
    }
    if (
      containsCanvasPoint(retireConfirmButtonRects.cancel, point.x, point.y)
    ) {
      return {type: 'retire_cancel'};
    }
    return {type: 'none', absorb: true};
  }

  if (containsCanvasPoint(inputDockRects.button, point.x, point.y)) {
    return {type: 'recovery_check'};
  }
  if (
    state.recovery?.lastCheck?.allOk === true &&
    containsCanvasPoint(inputDockRects.trainComplete, point.x, point.y)
  ) {
    return {type: 'end_session', mode: 'resolve'};
  }
  if (containsCanvasPoint(inputDockRects.retire, point.x, point.y)) {
    return {type: 'retire_request'};
  }
  if (containsCanvasPoint(inputDockRects.input, point.x, point.y)) {
    return {type: 'focus_command_input'};
  }

  const centerTool = centerToolAt(point.x, point.y);
  if (centerTool) return {type: 'center_tool', tool: centerTool};

  const editorFilePath = editorFileAt(point.x, point.y, state);
  if (editorFilePath) return {type: 'open_editor_file', path: editorFilePath};

  if (scenario) {
    const expandedMonitor = state.world.expandedMonitor;
    const activePanelTab = state.monitors.right.activePanelTab;
    const primaryTab = rightPanelPrimaryTabAt(
      point.x,
      point.y,
      expandedMonitor
    );
    if (primaryTab) return {type: 'right_panel_tab', tab: primaryTab};

    const visibleRunbookList = visibleRunbooks(scenario, state.clock.elapsedMs);
    const tabIndex = runbookTabAt(
      point.x,
      point.y,
      visibleRunbookList.length,
      visibleRunbookList.map((item) => item.title),
      expandedMonitor,
      activePanelTab
    );
    if (tabIndex >= 0) {
      const runbook = visibleRunbookList[tabIndex];
      if (runbook) {
        return {
          type: 'runbook_tab',
          index: tabIndex,
          runbookId: runbook.id,
        };
      }
    }
  }

  if (containsCanvasPoint(notificationBellRegion, point.x, point.y)) {
    return {type: 'notification_bell'};
  }

  const chatTarget = chatComposeAt(
    point.x,
    point.y,
    state.monitors.right.activePanelTab,
    state.world.expandedMonitor
  );
  if (chatTarget === 'send') return {type: 'chat_send'};
  if (chatTarget === 'compose') return {type: 'chat_compose'};

  if (state.world.expandedMonitor) {
    if (!containsCanvasPoint(expandedMonitorLayout, point.x, point.y)) {
      return {type: 'close_expanded_monitor'};
    }
    return {type: 'none', absorb: true};
  }

  const monitorMagnify = monitorMagnifyAt(point.x, point.y);
  if (monitorMagnify) {
    return {type: 'toggle_expanded_monitor', monitor: monitorMagnify};
  }

  if (state.chatCompose.active) return {type: 'deactivate_chat_compose'};
  return {type: 'none'};
}

export function editorFileAt(
  x: number,
  y: number,
  state: GameRenderState | undefined
) {
  if (!state || state.monitors.center.activeTool !== 'editor') return undefined;
  if (
    state.world.expandedMonitor &&
    state.world.expandedMonitor !== 'terminal'
  ) {
    return undefined;
  }
  const expanded = state.world.expandedMonitor === 'terminal';
  const monitor = expanded ? expandedMonitorLayout : monitorLayout('terminal');
  const content = monitorContentRegion(
    monitor,
    monitorHeaderHeight('terminal')
  );
  const scale = Math.min(
    content.width / monitorContentWidth,
    content.height / monitorContentHeight
  );
  const localX = (x - content.x) / scale;
  const localY = (y - content.y) / scale;
  const fileListTop = 66;
  if (
    localX < 0 ||
    localX > 142 ||
    localY < fileListTop ||
    localY > fileListTop + 470
  ) {
    return undefined;
  }
  const index = Math.floor((localY - fileListTop - 8) / 28);
  return state.monitors.center.editor.files[index]?.path;
}
