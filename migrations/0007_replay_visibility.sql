alter table replays add column visibility text not null default 'private' check (
  visibility in ('private', 'unlisted', 'public')
);

create table replay_read_tokens (
  id text primary key check (length(id) > 0),
  replay_id text not null check (length(replay_id) > 0),
  token_hash text not null check (length(token_hash) = 64),
  scope text not null default 'read' check (scope = 'read'),
  expires_at text not null check (length(expires_at) > 0),
  revoked_at text,
  created_at text not null check (length(created_at) > 0),
  unique (replay_id, token_hash)
);

create index replay_read_tokens_replay_expiry_idx
  on replay_read_tokens (replay_id, expires_at);
