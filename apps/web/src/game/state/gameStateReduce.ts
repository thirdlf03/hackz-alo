import type {GameRenderState} from '@incident/shared';
import {mergedChatMessages, visibleRunbooks} from './gameSelectors.js';
import type {GameStateAction} from './gameStateActions.js';

export function reduceGameState(
  state: GameRenderState,
  action: GameStateAction
): GameRenderState {
  switch (action.type) {
    case 'dismiss_navigation_step': {
      const stepId = action.stepId;
      if (state.navigation.dismissedStepIds.includes(stepId)) return state;
      return {
        ...state,
        navigation: {
          dismissedStepIds: [...state.navigation.dismissedStepIds, stepId],
        },
      };
    }
    case 'set_right_panel_tab': {
      const tab = action.tab;
      if (state.monitors.right.activePanelTab === tab) return state;
      const seenChatIds =
        tab === 'chat'
          ? [
              ...new Set([
                ...state.seenChatIds,
                ...mergedChatMessages(state).map((message) => message.id),
              ]),
            ]
          : state.seenChatIds;
      return {
        ...state,
        monitors: {
          ...state.monitors,
          right: {
            ...state.monitors.right,
            activePanelTab: tab,
          },
        },
        seenChatIds,
        chatCompose:
          tab === 'chat'
            ? state.chatCompose
            : {...state.chatCompose, active: false},
      };
    }
    case 'set_active_runbook': {
      const runbook = visibleRunbooks(action.scenario, state.clock.elapsedMs)[
        action.index
      ];
      if (!runbook) return state;
      const openedRunbookIds = state.openedRunbookIds.includes(runbook.id)
        ? state.openedRunbookIds
        : [...state.openedRunbookIds, runbook.id];
      return {
        ...state,
        monitors: {
          ...state.monitors,
          right: {
            ...state.monitors.right,
            activePanelTab: 'runbook',
            activeRunbook: runbook,
            activeRunbookIndex: action.index,
          },
        },
        openedRunbookIds,
      };
    }
    case 'set_center_tool': {
      const activeTool = action.activeTool;
      if (state.monitors.center.activeTool === activeTool) return state;
      return {
        ...state,
        commandInputFocused:
          activeTool === 'terminal' ? state.commandInputFocused : false,
        monitors: {
          ...state.monitors,
          center: {
            ...state.monitors.center,
            activeTool,
          },
        },
      };
    }
    case 'update_editor_panel': {
      const editor = action.updater(state.monitors.center.editor);
      return {
        ...state,
        monitors: {
          ...state.monitors,
          center: {
            ...state.monitors.center,
            editor,
          },
        },
      };
    }
    case 'toggle_notification_panel': {
      const panelOpen = !state.notifications.panelOpen;
      const readAlertIds = panelOpen
        ? [
            ...new Set([
              ...state.notifications.readAlertIds,
              ...state.monitors.left.alerts.map((alert) => alert.id),
            ]),
          ]
        : state.notifications.readAlertIds;
      const seenChatIds = panelOpen
        ? [
            ...new Set([
              ...state.seenChatIds,
              ...mergedChatMessages(state).map((message) => message.id),
            ]),
          ]
        : state.seenChatIds;
      return {
        ...state,
        notifications: {
          ...state.notifications,
          panelOpen,
          readAlertIds,
          pulseMs: panelOpen ? 0 : state.notifications.pulseMs,
        },
        seenChatIds,
        chatCompose: panelOpen
          ? state.chatCompose
          : {...state.chatCompose, active: false},
      };
    }
    case 'activate_chat_compose':
      return {
        ...state,
        commandInputFocused: false,
        chatCompose: {...state.chatCompose, active: true},
      };
    case 'focus_command_input':
      if (state.commandInputFocused) return state;
      return {...state, commandInputFocused: true};
    case 'blur_command_input':
      if (!state.commandInputFocused) return state;
      return {...state, commandInputFocused: false};
    case 'deactivate_chat_compose':
      if (!state.chatCompose.active && state.chatCompose.draft === '') {
        return state;
      }
      return {
        ...state,
        chatCompose: {active: false, draft: ''},
      };
    case 'set_chat_draft':
      return {
        ...state,
        chatCompose: {...state.chatCompose, draft: action.draft},
      };
    case 'submit_player_chat_message': {
      const trimmed = action.body.trim();
      if (!trimmed) return state;
      const message = {
        id: `player-${crypto.randomUUID()}`,
        atMs: action.atMs,
        from: 'あなた',
        body: trimmed,
      };
      return {
        ...state,
        playerChatMessages: [...state.playerChatMessages, message],
        chatCompose: {active: false, draft: ''},
      };
    }
    case 'toggle_expanded_monitor': {
      const expandedMonitor =
        state.world.expandedMonitor === action.monitor ? null : action.monitor;
      return {
        ...state,
        world: {...state.world, expandedMonitor},
      };
    }
  }
}
