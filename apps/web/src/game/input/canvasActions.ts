import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {visibleRunbooks} from '../state/gameState.js';
import {
  centerToolAt,
  containsCanvasPoint,
  expandedMonitorLayout,
  inputDockRects,
  monitorContentHeight,
  monitorContentWidth,
  monitorLayout,
  monitorMagnifyAt,
  navigationOverlayRect,
  notificationBellRegion,
  rightPanelPrimaryTabAt,
  runbookTabAt,
  slackComposeAt,
  type MonitorId,
  type RightPanelTab,
} from '../render/canvasLayout.js';

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasAction =
  | {type: 'end_session'; mode: 'resolve' | 'retire'}
  | {type: 'focus_command_input'}
  | {type: 'center_tool'; tool: 'terminal' | 'editor'}
  | {type: 'open_editor_file'; path: string}
  | {type: 'right_panel_tab'; tab: RightPanelTab}
  | {type: 'runbook_tab'; index: number; runbookId: string}
  | {type: 'notification_bell'}
  | {type: 'dismiss_navigation'; stepId: string}
  | {type: 'close_expanded_monitor'}
  | {type: 'toggle_expanded_monitor'; monitor: MonitorId}
  | {type: 'slack_send'}
  | {type: 'slack_compose'}
  | {type: 'deactivate_slack_compose'}
  | {type: 'none'; absorb?: boolean};

export function resolveCanvasAction(
  point: CanvasPoint,
  state: GameRenderState,
  scenario?: ScenarioDefinition
): CanvasAction {
  if (containsCanvasPoint(inputDockRects.button, point.x, point.y)) {
    return {type: 'end_session', mode: 'resolve'};
  }
  if (containsCanvasPoint(inputDockRects.retire, point.x, point.y)) {
    return {type: 'end_session', mode: 'retire'};
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

  if (
    containsCanvasPoint(navigationOverlayRect, point.x, point.y) &&
    state.navigation.activeStepId
  ) {
    return {type: 'dismiss_navigation', stepId: state.navigation.activeStepId};
  }

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

  const slackTarget = slackComposeAt(
    point.x,
    point.y,
    state.monitors.right.activePanelTab,
    state.world.expandedMonitor
  );
  if (slackTarget === 'send') return {type: 'slack_send'};
  if (slackTarget === 'compose') return {type: 'slack_compose'};

  if (state.slackCompose.active) return {type: 'deactivate_slack_compose'};
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
  const contentX = monitor.x + 22;
  const contentY = monitor.y + 64;
  const contentWidth = monitor.width - 44;
  const contentHeight = monitor.height - 80;
  const scale = Math.min(
    contentWidth / monitorContentWidth,
    contentHeight / monitorContentHeight
  );
  const localX = (x - contentX) / scale;
  const localY = (y - contentY) / scale;
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
