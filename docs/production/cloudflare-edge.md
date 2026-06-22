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

## WAF (dashboard)

`*.workers.dev` is not a zone you control, so managed WAF rules for a custom hostname generally
do not apply until you attach your own domain.

Until then, rely on:

- Worker KV rate limits (production only)
- Turnstile on session create (after setup below)
- Write token on replay uploads

When you add a custom domain:

1. Cloudflare dashboard → your zone
2. **Security** → **WAF** → **Managed rules**
3. Enable **Cloudflare OWASP Core Ruleset** scoped to `/api/*`
4. Start in **Log**, then **Block** after review

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

1. Dashboard → **Notifications**
2. Enable billing usage alerts for Workers, R2 egress, D1 rows read
3. Set a monthly threshold you are comfortable with

## Deploy checklist

```sh
# production Worker flag (already set)
pnpm exec wrangler secret put ENVIRONMENT -c apps/worker/wrangler.toml
# body: production

# optional bot protection (or: pnpm run setup:edge)
pnpm run setup:edge

# GitHub deploy secrets: CLOUDFLARE_API_TOKEN, INCIDENT_WORKER_URL, TURNSTILE_SITE_KEY
git tag v0.1.x && git push origin v0.1.x
```
