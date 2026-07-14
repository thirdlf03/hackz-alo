import type {
  EditorPanelState,
  GameRenderState,
  ScenarioDefinition,
} from '@incident/shared';

type RecoveryLastCheck = NonNullable<
  NonNullable<GameRenderState['recovery']>['lastCheck']
>;

export type GameStateAction =
  | {type: 'dismiss_navigation_step'; stepId: string}
  | {type: 'set_right_panel_tab'; tab: 'runbook' | 'chat'}
  | {
      type: 'set_active_runbook';
      scenario: ScenarioDefinition;
      index: number;
    }
  | {
      type: 'set_center_tool';
      activeTool: GameRenderState['monitors']['center']['activeTool'];
    }
  | {
      type: 'update_editor_panel';
      updater: (editor: EditorPanelState) => EditorPanelState;
    }
  | {type: 'toggle_notification_panel'}
  | {type: 'activate_chat_compose'}
  | {type: 'focus_command_input'}
  | {type: 'blur_command_input'}
  | {type: 'deactivate_chat_compose'}
  | {type: 'set_chat_draft'; draft: string}
  | {
      type: 'submit_player_chat_message';
      body: string;
      atMs: number;
    }
  | {
      type: 'append_npc_chat_message';
      body: string;
      atMs: number;
      from: string;
    }
  | {
      type: 'toggle_expanded_monitor';
      monitor: 'metrics' | 'terminal' | 'runbook';
    }
  | {type: 'set_recovery_checking'; checking: boolean}
  | {type: 'set_recovery_last_check'; lastCheck: RecoveryLastCheck}
  | {type: 'set_retire_confirming'; confirming: boolean};
