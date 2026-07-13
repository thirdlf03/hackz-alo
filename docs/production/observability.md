# Observability

## Health endpoints

- `GET /api/health` — liveness
- `GET /api/ready` — D1 + R2 binding check

## Structured logs

Worker emits JSON lines for:

- `session_created`
- `session_prepared`
- `replay_chunk_uploaded`
- `replay_finalized`
- `replay_chunks_purged`
- `replay_chunk_cleanup_failed`
- `replay_chunk_cleanup_sweep`
- `session_cost_baseline`
- `sandbox_started`
- `sandbox_start_failed`
- `sandbox_destroyed`
- `session_sweep`
- `session_sweep_failed`
- `retention_sweep`
- `retention_sweep_failed`
- `rate_limit_hit`

Each response includes `X-Request-Id`.

## Cost baseline measurement

The following events are emitted at lifecycle boundaries so that cost changes
can be compared with user-visible behavior. They intentionally contain IDs and
sizes/timings only; they do not contain video bytes, terminal input, or request
bodies.

| Event                   | Main fields                                                                                          | Use                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `session_cost_baseline` | `status`, `gameDurationMs`, `wallDurationMs`                                                         | Container/session duration proxy           |
| `session_prepared`      | `scenarioId`, `reused`, `durationMs`                                                                 | Sandbox warm-up latency                    |
| `sandbox_started`       | `processCount`, `waitForPortCount`, `durationMs`                                                     | Sandbox startup latency and workload shape |
| `sandbox_destroyed`     | `durationMs`, `killAllProcessesOk`, `destroyOk`                                                      | Cleanup latency and leak detection         |
| `replay_chunk_uploaded` | `seq`, `byteSize`, `startedAtMs`, `endedAtMs`, `idempotent`                                          | Recording bytes and retry rate             |
| `replay_finalized`      | `storagePath`, `chunkCount`, `rawChunkBytes`, `finalVideoBytes`, `recordingDurationMs`, `durationMs` | R2 duplication and finalize latency        |
| `replay_chunks_purged`  | `chunkCount`, `rawChunkBytes`, `durationMs`                                                          | Raw chunk reclamation                      |

Collect at least one full billing cycle before changing retention, bitrate, or
Sandbox sleep settings. Aggregate by day and scenario, then compare:

```text
raw_chunk_bytes / final_video_bytes
sum(wallDurationMs) / completed sessions
count(idempotent=true) / count(replay_chunk_uploaded)
count(sandbox_destroyed where destroyOk=false)
```

The first two ratios are the decision inputs for raw-chunk garbage collection
and Sandbox lifecycle changes. Keep the existing UX guardrails in the rollout
plan: session-start p95, recording finalize success, replay playback success,
and Sandbox cold-start p95.

Raw chunks are deleted asynchronously after `/finish` or multipart completion,
only after an R2 `HEAD` confirms that the final video exists. If deletion
fails, the 10-minute scheduled sweep retries ready replays. Until deletion
completes, the replay remains playable from the final video and the raw chunk
metadata remains available for retry.

## Alerts (recommended)

| Signal                   | Threshold               |
| ------------------------ | ----------------------- |
| Worker 5xx rate          | > 1% for 5m             |
| `POST /api/sessions` 503 | > 5/min                 |
| p95 latency              | > 3s on `/api/sessions` |
| R2 egress                | week-over-week 2x       |
| `session_sweep_failed`   | any in 15m              |

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
