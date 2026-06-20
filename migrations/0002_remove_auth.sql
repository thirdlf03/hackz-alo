drop table if exists users;

create table play_sessions_new (
  id text primary key check (length(id) > 0),
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

insert into play_sessions_new
  (id, scenario_id, scenario_version, sandbox_id, replay_id, status, started_at, finished_at, result, duration_ms, created_at)
select id, scenario_id, scenario_version, sandbox_id, replay_id, status, started_at, finished_at, result, duration_ms, created_at
from play_sessions;

drop table play_sessions;
alter table play_sessions_new rename to play_sessions;

create table replays_new (
  id text primary key check (length(id) > 0),
  session_id text not null check (length(session_id) > 0),
  scenario_id text not null check (length(scenario_id) > 0),
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  started_at text not null check (length(started_at) > 0),
  finished_at text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  result text check (result is null or result in ('resolved', 'failed', 'retired', 'aborted')),
  ending_id text,
  video_object_key text check (video_object_key is null or length(video_object_key) > 0),
  event_log_object_key text check (event_log_object_key is null or length(event_log_object_key) > 0),
  thumbnail_object_key text check (thumbnail_object_key is null or length(thumbnail_object_key) > 0),
  featured integer not null default 0 check (featured in (0, 1)),
  browser_info_json text,
  recording_status text not null check (
    recording_status in (
      'idle', 'consent_required', 'initializing', 'recording', 'stopping', 'finalizing', 'ready',
      'recording_error', 'upload_degraded', 'finalization_failed', 'unsupported_browser'
    )
  ),
  mime_type text check (mime_type is null or length(mime_type) > 0),
  created_at text not null check (length(created_at) > 0),
  updated_at text not null check (length(updated_at) > 0)
);

insert into replays_new
  (id, session_id, scenario_id, difficulty, started_at, finished_at, duration_ms, result,
   video_object_key, event_log_object_key, thumbnail_object_key, browser_info_json,
   recording_status, mime_type, created_at, updated_at)
select id, session_id, scenario_id, difficulty, started_at, finished_at, duration_ms, result,
       video_object_key, event_log_object_key, thumbnail_object_key, browser_info_json,
       recording_status, mime_type, created_at, updated_at
from replays;

drop table replays;
alter table replays_new rename to replays;

create table replay_comments (
  id text primary key check (length(id) > 0),
  replay_id text not null check (length(replay_id) > 0),
  at_ms integer not null check (at_ms >= 0),
  body text not null check (length(body) > 0),
  created_at text not null check (length(created_at) > 0)
);

create unique index play_sessions_replay_id_idx on play_sessions (replay_id);
create index play_sessions_scenario_idx on play_sessions (scenario_id, scenario_version);
create unique index replays_session_id_idx on replays (session_id);
create index replays_featured_created_idx on replays (featured, created_at desc);
create index replay_comments_replay_at_idx on replay_comments (replay_id, at_ms);
