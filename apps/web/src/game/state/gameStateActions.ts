import type {
  EditorPanelState,
  GameRenderState,
  ScenarioDefinition,
} from '@incident/shared';

export type GameStateAction =
  | {type: 'dismiss_navigation_step'; stepId: string}
  | {type: 'set_right_panel_tab'; tab: 'runbook' | 'slack'}
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
  | {type: 'activate_slack_compose'}
  | {type: 'focus_command_input'}
  | {type: 'blur_command_input'}
  | {type: 'deactivate_slack_compose'}
  | {type: 'set_slack_draft'; draft: string}
  | {
      type: 'submit_player_slack_message';
      body: string;
      atMs: number;
    }
  | {
      type: 'toggle_expanded_monitor';
      monitor: 'metrics' | 'terminal' | 'runbook';
    };
