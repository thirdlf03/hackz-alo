# Load and Capacity Tests

Run manually before major launches.

## Sandbox capacity

1. Start 5 concurrent sessions (matches `max_instances = 5`)
2. Attempt 6th session — expect **503** with `Retry-After`
3. Retire one session — 6th should succeed within 60s

## Recording finalize

1. Upload 360 chunks (30 min @ 5s) via API with write token
2. `POST /api/replays/:id/finalize-video` completes without Worker OOM
3. `GET /api/replays/:id/video` returns 200

## Session creation burst

1. 100 `POST /api/sessions` in 1 minute from one IP
2. Cloudflare Rate Limiting or KV rate limit returns 429
