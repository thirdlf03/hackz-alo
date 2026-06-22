alter table replays add column consent_recorded_at text check (
  consent_recorded_at is null or length(consent_recorded_at) > 0
);
