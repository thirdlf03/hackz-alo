export const REPLAY_EVENT_TYPES = [
  'session_start',
  'session_end',
  'scenario_event',
  'alert',
  'monitor_update',
  'terminal_input',
  'terminal_output',
  'command_detected',
  'ui_click',
  'ui_panel_open',
  'runbook_open',
  'slack_message_read',
  'file_opened',
  'file_saved',
  'service_restart',
  'recovery_check',
  'incident_resolved',
  'player_note',
  'recording_chunk_created',
  'recording_error',
  'sandbox_error',
] as const;

export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[number];

export const REPLAY_EVENT_VISIBILITY_VALUES = [
  'public_safe',
  'private',
  'sensitive',
] as const;
