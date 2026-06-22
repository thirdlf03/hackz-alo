# Production Runbook

## Deploy

```sh
pnpm run build:scenarios
pnpm run build
pnpm run db:migrate:remote
pnpm run deploy
curl -sf "$INCIDENT_WORKER_URL/api/ready"
```

Or tag push / workflow_dispatch via `.github/workflows/deploy.yml`.

## Rollback

1. `git checkout <previous-tag>`
2. `pnpm run deploy`
3. Verify `/api/ready`

## D1 migration failure

- Do not deploy Worker until migration succeeds
- Restore D1 from Cloudflare backup if partial apply

## R2 cost spike

1. Check Rate Limiting rules
2. Run retention sweep manually (cron runs weekly)
3. `pnpm run cleanup:sessions -- --stale`

## Sandbox unavailable

1. Check Cloudflare status + container platform
2. Confirm Docker image deploy in wrangler logs
3. Reduce concurrent sessions messaging if at capacity

## Suspected replay tampering

1. Search logs for `replayId` + `X-Request-Id`
2. Verify write token was required on upload routes
3. Compare chunk `sha256` in D1 vs R2
