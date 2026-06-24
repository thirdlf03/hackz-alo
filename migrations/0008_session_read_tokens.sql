create table session_read_tokens (
  id text primary key check (length(id) > 0),
  session_id text not null check (length(session_id) > 0),
  token_hash text not null check (length(token_hash) = 64),
  scope text not null default 'read' check (scope = 'read'),
  expires_at text not null check (length(expires_at) > 0),
  revoked_at text,
  created_at text not null check (length(created_at) > 0),
  unique (session_id, token_hash)
);

create index session_read_tokens_session_expiry_idx
  on session_read_tokens (session_id, expires_at);
