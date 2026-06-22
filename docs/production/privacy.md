# Privacy and Recording Policy

## What is stored

- Canvas gameplay video (optional, with consent)
- Timeline events (commands as summaries, not raw terminal buffers in public API)
- Session metadata (scenario, duration, result)

## Retention

- Replays and related R2 objects are deleted **90 days** after finish (see retention cron)
- Stale sessions are swept after 20–30 minutes without activity

## User controls

- Briefing screen: opt out of server-side recording save
- Recording consent checkbox required before play

## Public replay links

- Shared URLs expose summary timeline and video
- Terminal input payloads are not returned by the public events API
- Users see a warning before copying share links
