create table session_participants (
  session_id text not null check (length(session_id) > 0),
  participant_id text not null check (length(participant_id) > 0),
  display_name text not null check (length(display_name) > 0),
  role text not null check (role in ('incident_commander', 'ops', 'scribe', 'comms', 'facilitator', 'observer')),
  team_id text,
  ready integer not null default 0 check (ready in (0, 1)),
  joined_at text not null check (length(joined_at) > 0),
  last_seen_at text not null check (length(last_seen_at) > 0),
  primary key (session_id, participant_id)
);

create table session_tasks (
  session_id text not null check (length(session_id) > 0),
  task_id text not null check (length(task_id) > 0),
  title text not null check (length(title) > 0),
  status text not null check (status in ('open', 'in_progress', 'done', 'blocked')),
  assignee_participant_id text,
  created_by_participant_id text,
  created_at text not null check (length(created_at) > 0),
  updated_at text not null check (length(updated_at) > 0),
  primary key (session_id, task_id)
);

create table session_injects (
  session_id text not null check (length(session_id) > 0),
  inject_id text not null check (length(inject_id) > 0),
  title text not null check (length(title) > 0),
  body text not null check (length(body) > 0),
  fired integer not null default 0 check (fired in (0, 1)),
  fired_at text,
  fired_by_participant_id text,
  primary key (session_id, inject_id)
);

create table session_incident_log (
  session_id text not null check (length(session_id) > 0),
  entry_id text not null check (length(entry_id) > 0),
  kind text not null check (kind in ('note', 'decision', 'hypothesis', 'comms', 'follow_up', 'role_deviation')),
  body text not null check (length(body) > 0),
  actor_participant_id text,
  created_at text not null check (length(created_at) > 0),
  primary key (session_id, entry_id)
);

create table session_hotwash_notes (
  session_id text not null check (length(session_id) > 0),
  note_id text not null check (length(note_id) > 0),
  participant_id text,
  went_well text not null,
  improve text not null,
  follow_up text not null,
  created_at text not null check (length(created_at) > 0),
  primary key (session_id, note_id)
);

create table session_after_action_reports (
  session_id text primary key check (length(session_id) > 0),
  report_json text not null check (json_valid(report_json)),
  generated_at text not null check (length(generated_at) > 0)
);

create index session_tasks_session_status_idx
  on session_tasks (session_id, status);

create index session_incident_log_session_created_idx
  on session_incident_log (session_id, created_at);
