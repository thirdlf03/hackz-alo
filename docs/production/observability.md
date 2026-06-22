# Observability

## Health endpoints

- `GET /api/health` — liveness
- `GET /api/ready` — D1 + R2 binding check

## Structured logs

Worker emits JSON lines for:

- `session_created`
- `replay_chunk_uploaded`
- `replay_finalized`
- `session_sweep`
- `rate_limit_hit`

Each response includes `X-Request-Id`.

## Alerts (recommended)

| Signal                   | Threshold               |
| ------------------------ | ----------------------- |
| Worker 5xx rate          | > 1% for 5m             |
| `POST /api/sessions` 503 | > 5/min                 |
| p95 latency              | > 3s on `/api/sessions` |
| R2 egress                | week-over-week 2x       |
| `[session-sweep]` errors | any in 15m              |

## Logpush

Optional: enable Workers Logpush to your SIEM for `/api/*` requests.
