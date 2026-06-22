# Cloudflare Edge Protection

Apply these settings before public launch. Application-level rate limits and security
headers are already enforced in the Worker when `ENVIRONMENT=production`.

## Already in Worker code

| Protection                               | Where                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sessions` 5/min/IP            | `sessionRoutes.ts` + KV                                                                                                 |
| `POST /api/replays/*/chunks` 120/min/IP  | `replayRoutes.ts` + KV                                                                                                  |
| `POST /api/replays/*/comments` 10/min/IP | `replayRoutes.ts` + KV                                                                                                  |
| Security headers on all responses        | `securityHeaders.ts` (API + static assets via Worker)                                                                   |
| Turnstile on session create (optional)   | Worker verifies when `TURNSTILE_SECRET_KEY` is set; Web sends token when `VITE_TURNSTILE_SITE_KEY` is set at build time |

Dashboard Rate Limiting rules are optional extra defense; KV limits above apply even
without dashboard rules.

## Transform Rules (static assets)

On `*.workers.dev` you do not own the zone, so dashboard Transform Rules usually do not apply.
This project serves static assets through the Worker (`run_worker_first = true`) and adds the same
security headers as `/api/*` in code. No dashboard rule is required for headers.

If you add a custom domain later, you can mirror the same headers with Transform Rules as backup.

## Custom domain (`incident.thirdlf03.com`)

`thirdlf03.com` must be on the same Cloudflare account as the Worker. Wrangler creates the
DNS record and TLS certificate on deploy.

```toml
# apps/worker/wrangler.toml
[[routes]]
pattern = "incident.thirdlf03.com"
custom_domain = true
```

`*.workers.dev` remains available unless you set `workers_dev = false`.

### One-time setup

```sh
export CLOUDFLARE_API_TOKEN=...   # Zone:Read + Turnstile:Edit
pnpm run setup:domain            # zone check, Turnstile domains, INCIDENT_WORKER_URL secret
git tag v0.1.x && git push origin v0.1.x
```

Override hostname or zone:

```sh
INCIDENT_WORKER_HOST=training.thirdlf03.com INCIDENT_ZONE=thirdlf03.com pnpm run setup:domain
```

After deploy:

```sh
curl -sf https://incident.thirdlf03.com/api/ready
```

API protection uses Worker KV rate limits and Turnstile (no dashboard WAF).

## Turnstile (automated setup)

Requires API token with **Turnstile → Edit** (add to your deploy token or create a one-off token):

```sh
export CLOUDFLARE_API_TOKEN=...
pnpm run setup:edge
```

This creates an invisible widget, sets `TURNSTILE_SECRET_KEY` on the Worker, and stores
`TURNSTILE_SITE_KEY` in GitHub secrets. Redeploy with a new tag so the web build picks up the site key.

Local dev: `apps/web/.env.local`

```
VITE_TURNSTILE_SITE_KEY=your_site_key
```

Until both Worker secret and site key exist, Turnstile is skipped and sessions work as today.

## Access (Zero Trust)

- Protect `/api/dev/*` and `/api/admin/*`
- Do **not** put Access on public game `/api/sessions` (anonymous play)

Suggested policy:

1. **Access** → **Applications** → Add self-hosted app
2. Domain: worker hostname, path `/api/admin/*`
3. Policy: Allow emails / service token for operators only
4. Repeat for `/api/dev/*` if exposed (production returns 404 for dev routes)

Admin API also accepts `x-admin-secret` when Access JWT is absent (`ADMIN_SECRET`).

## Billing alerts

Pay-as-you-go accounts only (not Enterprise contracts).

詳細（Budget vs Usage、Webhook の可否、Uptime Kuma）: [ops-notes.md](./ops-notes.md)

### Account-wide budget (recommended first)

1. Dashboard → select account (top-left) → **Billing** → **Billable Usage**
2. **Create budget alert** (or **Manage notifications**)
3. Set a monthly USD threshold (e.g. $10, $25, $50) for **total account** usage
4. Add email recipients

You get alerts at 50%, 75%, 90%, and 100% of the budget.

Alternative path: **Notifications** → **Add** → **Billing** → **Budget Alert**.

### Product-specific usage alerts

**Notifications** → **Add** → **Usage Based Billing**（Email / **Webhook** / PagerDuty 可。閾値はメトリクス単位でドルではない）:

| Product         | Typical alert                |
| --------------- | ---------------------------- |
| Workers         | Requests, CPU time, duration |
| R2              | Class A/B operations, egress |
| D1              | Rows read/written, storage   |
| Durable Objects | Requests, duration           |

For this app, start with:

- **Workers** — request count spike (abuse or traffic surge)
- **R2** — egress (replay video downloads)
- **D1** — rows read (session/replay queries)

Set thresholds above your normal monthly baseline so alerts are actionable, not noise.

### What to watch for incident-training

- Sudden **Workers request** increase → bot traffic or replay chunk spam (KV limits help)
- **R2 egress** → large replay views or hot objects
- **D1 rows read** → list endpoints under load

Review **Analytics & Logs** → **Workers** after an alert fires.

## Deploy checklist

```sh
# production Worker flag (already set)
pnpm exec wrangler secret put ENVIRONMENT -c apps/worker/wrangler.toml
# body: production

# optional bot protection (or: pnpm run setup:edge)
pnpm run setup:edge

# custom domain (thirdlf03.com on Cloudflare)
pnpm run setup:domain

# GitHub deploy secrets: CLOUDFLARE_API_TOKEN (include Zone → Workers Routes → Edit for custom domain in wrangler.toml), INCIDENT_WORKER_URL, TURNSTILE_SITE_KEY
git tag v0.1.x && git push origin v0.1.x
```
