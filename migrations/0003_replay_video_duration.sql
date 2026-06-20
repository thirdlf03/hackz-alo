alter table replays add column video_duration_ms integer check (video_duration_ms is null or video_duration_ms >= 0);
