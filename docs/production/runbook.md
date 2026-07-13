# Production Runbook

## Deploy

```sh
pnpm run build:scenarios
pnpm run build
pnpm run db:migrate:remote
pnpm run deploy
INCIDENT_WORKER_URL=https://incident.thirdlf03.com \
INCIDENT_SMOKE_TURNSTILE_TOKEN=<turnstile-test-token> \
pnpm run deploy:smoke
```

Or tag push / workflow_dispatch via `.github/workflows/deploy.yml`. The deploy
workflow requires these secrets:

- `INCIDENT_WORKER_URL`
- `TURNSTILE_SITE_KEY`
- `CLOUDFLARE_API_TOKEN`

The workflow's post-deploy smoke only runs a readiness check
(`--ready-only`), since Turnstile tokens are single-use and cannot be
provisioned in CI. Run the full smoke (session creation through
`INCIDENT_SMOKE_TURNSTILE_TOKEN`, as in the manual deploy example above)
by hand after deploying.

For a readiness-only emergency check:

```sh
INCIDENT_WORKER_URL=https://incident.thirdlf03.com pnpm run deploy:smoke -- --ready-only
```

## Rollback

1. `git checkout <previous-tag>`
2. `pnpm run deploy`
3. `pnpm run deploy:smoke`

## D1 migration failure

- Do not deploy Worker until migration succeeds
- Restore D1 from Cloudflare backup if partial apply

## R2 cost spike

1. Check Rate Limiting rules
2. Run retention sweep manually (cron runs weekly)
3. `pnpm run cleanup:sessions -- --stale`

## Retention and cleanup

| Job                     | Schedule                                        | Structured log                                        | Policy                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay retention        | Weekly cron (`sweepExpiredReplays`)             | `retention_sweep`, `retention_sweep_failed`           | Finished replays older than **30 days**; deletes R2 prefix + D1 rows (chunks, events, comments, MPU state, replay)                                                                                                                 |
| Finalized raw chunks    | Every 10 minutes (`sweepFinalizedReplayChunks`) | `replay_chunks_purged`, `replay_chunk_cleanup_failed` | After final video exists, deletes raw R2 chunks and `replay_chunks` rows; retries failed cleanup                                                                                                                                   |
| Stale sessions          | Every cron tick (`sweepStaleSessions`)          | `session_sweep`, `session_sweep_failed`               | Running >30m wall or created/briefing >20m                                                                                                                                                                                         |
| Multipart uploads (MPU) | On replay purge / session delete                | —                                                     | `replay_multipart_uploads` row removed with replay; abandoned MPU without finished replay is cleaned when parent replay is purged. No separate orphan MPU sweeper yet — monitor `replay_multipart_uploads` count vs active replays |

Manual session cleanup:

```sh
pnpm run cleanup:sessions -- --stale
```

## Sandbox unavailable

1. Check Cloudflare status + container platform
2. Confirm Docker image deploy in wrangler logs
3. Reduce concurrent sessions messaging if at capacity

## Suspected replay tampering

1. Search logs for `replayId` + `X-Request-Id`
2. Verify write token was required on upload routes
3. Compare chunk `sha256` in D1 vs R2
