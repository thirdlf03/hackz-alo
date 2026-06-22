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

Uptime は Cloudflare Health Checks（Pro 要）ではなく **Uptime Kuma 等の自前監視**。
Billing の Webhook の可否は [ops-notes.md](./ops-notes.md) を参照。

### Automated setup (`setup:ops`)

```sh
export CLOUDFLARE_API_TOKEN=...   # see permissions below
export ALERT_EMAIL=you@example.com
pnpm run setup:ops
```

API token permissions for `setup:ops` (add to deploy token or one-off token):

| Permission         | Scope                  |
| ------------------ | ---------------------- |
| Notifications Edit | Account (`--notify`)   |
| Logs Edit          | Account (Logpush only) |

Deploy token already has Workers Scripts Edit (for `ADMIN_SECRET` via wrangler).
`--health` needs Zone Health Checks Edit (**Pro plan**); skip on Free.

Retry a failed step without re-running admin:

```sh
pnpm run setup:ops -- --notify --logpush
```

This configures:

- `ADMIN_SECRET` on Worker + `INCIDENT_ADMIN_SECRET` in GitHub
- Usage notifications (Workers requests, R2 egress, D1 rows read) when `ALERT_EMAIL` is set
- Logpush instructions (or API setup when R2 API keys are set)
- Cloudflare Access steps for `/api/admin/*`

Flags: `--admin`, `--health`, `--notify`, `--logpush`, `--access-guide`

Load test after setup:

```sh
INCIDENT_WORKER_URL=https://incident.thirdlf03.com pnpm run load-test
```

## Logpush

Optional: enable Workers Logpush to your SIEM for `/api/*` requests.
