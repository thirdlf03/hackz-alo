alter table play_sessions add column write_token_hash text check (
  write_token_hash is null or length(write_token_hash) = 64
);
