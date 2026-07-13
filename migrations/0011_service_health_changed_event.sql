create table replay_events_index_new (
  replay_id text not null check (length(replay_id) > 0),
  event_id text not null check (length(event_id) > 0),
  type text not null check (
    type in (
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
      'chat_message_read',
      'file_opened',
      'file_saved',
      'service_restart',
      'service_health_changed',
      'recovery_check',
      'incident_resolved',
      'player_note',
      'recording_chunk_created',
      'recording_error',
      'sandbox_error'
    )
  ),
  at_ms integer not null check (at_ms >= 0),
  summary text,
  visibility text not null check (visibility in ('public_safe', 'private', 'sensitive')),
  primary key (replay_id, event_id)
);

insert into replay_events_index_new
  (replay_id, event_id, type, at_ms, summary, visibility)
select replay_id, event_id, type, at_ms, summary, visibility
from replay_events_index;

drop table replay_events_index;
alter table replay_events_index_new rename to replay_events_index;

create index replay_events_index_replay_at_idx on replay_events_index (replay_id, at_ms);
