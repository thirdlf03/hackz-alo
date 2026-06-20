create table users (
  id text primary key check (length(id) > 0),
  display_name text not null check (length(display_name) > 0),
  created_at text not null check (length(created_at) > 0)
);

create table scenarios (
  id text not null check (length(id) > 0),
  version integer not null check (version > 0),
  title text not null check (length(title) > 0),
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  manifest_object_key text not null check (length(manifest_object_key) > 0),
  created_at text not null check (length(created_at) > 0),
  primary key (id, version)
);

create table play_sessions (
  id text primary key check (length(id) > 0),
  user_id text not null check (length(user_id) > 0),
  scenario_id text not null check (length(scenario_id) > 0),
  scenario_version integer not null check (scenario_version > 0),
  sandbox_id text not null check (length(sandbox_id) > 0),
  replay_id text not null check (length(replay_id) > 0),
  status text not null check (status in ('created', 'briefing', 'running', 'resolved', 'failed', 'retired', 'aborted')),
  started_at text,
  finished_at text,
  result text check (result is null or result in ('resolved', 'failed', 'retired', 'aborted')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at text not null check (length(created_at) > 0)
);

create table replays (
  id text primary key check (length(id) > 0),
  user_id text not null check (length(user_id) > 0),
  session_id text not null check (length(session_id) > 0),
  scenario_id text not null check (length(scenario_id) > 0),
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  started_at text not null check (length(started_at) > 0),
  finished_at text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  result text check (result is null or result in ('resolved', 'failed', 'retired', 'aborted')),
  video_object_key text check (video_object_key is null or length(video_object_key) > 0),
  event_log_object_key text check (event_log_object_key is null or length(event_log_object_key) > 0),
  thumbnail_object_key text check (thumbnail_object_key is null or length(thumbnail_object_key) > 0),
  visibility text not null default 'private' check (visibility in ('private', 'self', 'unlisted', 'team', 'public')),
  browser_info_json text,
  recording_status text not null check (
    recording_status in (
      'idle',
      'consent_required',
      'initializing',
      'recording',
      'stopping',
      'finalizing',
      'ready',
      'recording_error',
      'upload_degraded',
      'finalization_failed',
      'unsupported_browser'
    )
  ),
  mime_type text check (mime_type is null or length(mime_type) > 0),
  created_at text not null check (length(created_at) > 0),
  updated_at text not null check (length(updated_at) > 0)
);

create table replay_chunks (
  replay_id text not null check (length(replay_id) > 0),
  seq integer not null check (seq >= 0 and seq <= 999999),
  object_key text not null check (length(object_key) > 0),
  byte_size integer not null check (byte_size >= 0),
  started_at_ms integer check (started_at_ms is null or started_at_ms >= 0),
  ended_at_ms integer check (ended_at_ms is null or ended_at_ms >= 0),
  sha256 text check (sha256 is null or length(sha256) = 64),
  uploaded_at text not null check (length(uploaded_at) > 0),
  check (started_at_ms is null or ended_at_ms is null or ended_at_ms >= started_at_ms),
  primary key (replay_id, seq)
);

create table replay_events_index (
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
      'slack_message_read',
      'file_opened',
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

create table replay_multipart_uploads (
  replay_id text primary key check (length(replay_id) > 0),
  object_key text not null check (length(object_key) > 0),
  upload_id text not null check (length(upload_id) > 0),
  next_part_number integer not null check (next_part_number >= 1),
  uploaded_parts_json text not null check (json_valid(uploaded_parts_json)),
  status text not null check (status in ('created', 'uploading', 'completed', 'aborted', 'failed')),
  created_at text not null check (length(created_at) > 0),
  updated_at text not null check (length(updated_at) > 0)
);

create unique index play_sessions_replay_id_idx on play_sessions (replay_id);
create index play_sessions_user_created_idx on play_sessions (user_id, created_at desc);
create index play_sessions_scenario_idx on play_sessions (scenario_id, scenario_version);

create unique index replays_session_id_idx on replays (session_id);
create index replays_user_created_idx on replays (user_id, created_at desc);
create index replays_visibility_created_idx on replays (visibility, created_at desc);

create index replay_events_index_replay_at_idx on replay_events_index (replay_id, at_ms);
create index replay_chunks_uploaded_at_idx on replay_chunks (uploaded_at);
