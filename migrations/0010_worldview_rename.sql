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
select
  replay_id,
  event_id,
  case when type = 'slack_message_read' then 'chat_message_read' else type end,
  at_ms,
  summary,
  visibility
from replay_events_index;

drop table replay_events_index;
alter table replay_events_index_new rename to replay_events_index;

create index replay_events_index_replay_at_idx on replay_events_index (replay_id, at_ms);

update replay_events_index
set summary = replace(summary, 'Slack報告: ', 'チャット報告: ')
where summary like 'Slack報告: %';

update replay_events_index
set summary = replace(summary, 'Slack 返信を開始', 'チャット返信を開始')
where summary like '%Slack 返信を開始%';

update play_sessions set scenario_id = 'kodama-batch-001' where scenario_id = 'unlang-batch-001';
update play_sessions set scenario_id = 'kodama-mystery-001' where scenario_id = 'unlang-mystery-001';

update replays set scenario_id = 'kodama-batch-001' where scenario_id = 'unlang-batch-001';
update replays set scenario_id = 'kodama-mystery-001' where scenario_id = 'unlang-mystery-001';
