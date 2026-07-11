# Incident Training Simulation

MVP implementation for the incident-response training game described in
`youken.md` and `tech.md`.

## Layout

- `apps/web`: Preact/Vite canvas game and replay UI
- `apps/worker`: Hono/Cloudflare Worker API and Durable Object session runtime
- `packages/shared`: API, scenario, replay, rendering, and storage contracts
- `packages/scenarios`: beginner scenarios and runbook metadata
- `sandbox`: local scripts that model the sandbox services and fault injection
- `migrations`: D1 schema
- `tests`: unit, integration, and e2e tests
- `docs/production`: runbook, edge protection, privacy, observability, [ops-notes](docs/production/ops-notes.md)

## Local Checks

```sh
pnpm test
pnpm run test:integration
pnpm run audit:schema-sync
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
```

`pnpm install` registers [Lefthook](https://lefthook.dev/) `pre-push` hooks that run
the same gates as the CI `test` job (`pnpm run ci:test`). Skip once with
`LEFTHOOK=0 git push`. Perf Playwright (`tests/e2e/perf.spec.ts`) runs only via
`pnpm run perf:e2e`, not the default `test:e2e` suite.

Install workspace dependencies before running the Vite/Worker dev servers:

```sh
pnpm install
pnpm run dev:web
pnpm run dev:worker
```

## Deploy (Worker + static frontend)

Production serves the Vite build from the same Worker as the API (`/api/*`).
Local development still uses separate Vite and Worker dev servers.

One-time Cloudflare setup:

```sh
wrangler login
pnpm run setup:cloudflare
pnpm run db:migrate:remote
```

Deploy:

```sh
pnpm run deploy
```

See [docs/production/runbook.md](docs/production/runbook.md) and
[docs/production/cloudflare-edge.md](docs/production/cloudflare-edge.md) for
production checklist.

`pnpm run deploy` builds scenarios, builds `apps/web/dist`, then runs `wrangler deploy`.
R2 bucket creation and container image upload are handled by Wrangler during deploy.

CI deploy uses `.github/workflows/deploy.yml` (tag `v*` or workflow_dispatch).

### GitHub Actions secrets (deploy workflow)

| Secret                 | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy + D1 remote migrations                                               |
| `INCIDENT_WORKER_URL`  | Post-deploy `GET /api/ready` smoke (custom domain: `https://incident.thirdlf03.com`) |
| `TURNSTILE_SITE_KEY`   | Optional Turnstile site key for web build                                            |

Create a Cloudflare API token with **Workers Scripts Edit**, **D1 Edit**, **Containers Edit**, **Account Settings Read**, **Zone → Workers Routes → Edit** (required for `incident.thirdlf03.com` in `wrangler.toml`), and optionally **Turnstile Edit** for `pnpm run setup:edge`, then:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo thirdlf03/hackz-alo
pnpm run setup:domain   # sets INCIDENT_WORKER_URL to https://incident.thirdlf03.com
```

## Environment variables (Worker secrets)

| Name                    | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `ENVIRONMENT`           | Set to `production` to disable dev routes                             |
| `TURNSTILE_SECRET_KEY`  | Optional bot protection on session create                             |
| `ADMIN_SECRET`          | Admin API fallback when Access JWT absent                             |
| `VAPID_PUBLIC_KEY`      | Web Push の VAPID 公開鍵(ページャー機能。未設定なら機能は無効化)      |
| `VAPID_PRIVATE_KEY`     | Web Push の VAPID 秘密鍵                                              |
| `VAPID_SUBJECT`         | VAPID subject(`mailto:` 形式)                                         |
| `CF_TURN_KEY_ID`        | Cloudflare Calls TURN 鍵の ID(ウォールーム音声。未設定なら STUN のみ) |
| `CF_TURN_KEY_API_TOKEN` | Cloudflare Calls TURN 鍵の API トークン                               |

### ウォールーム音声(WebRTC)の TURN セットアップ

[Cloudflare Calls ダッシュボード](https://dash.cloudflare.com/?to=/:account/calls) で TURN 鍵を作成し、
worker のシークレットに設定すると NAT 越えに Cloudflare TURN が使われます。

```sh
pnpm exec wrangler secret put CF_TURN_KEY_ID -c apps/worker/wrangler.toml
pnpm exec wrangler secret put CF_TURN_KEY_API_TOKEN -c apps/worker/wrangler.toml
```

未設定の場合は `stun:stun.cloudflare.com:3478` のみで接続を試みます(同一 NAT 内なら大抵つながります)。

### ページャー(Web Push)の VAPID 鍵セットアップ

```sh
npx web-push generate-vapid-keys
pnpm exec wrangler secret put VAPID_PUBLIC_KEY -c apps/worker/wrangler.toml
pnpm exec wrangler secret put VAPID_PRIVATE_KEY -c apps/worker/wrangler.toml
pnpm exec wrangler secret put VAPID_SUBJECT -c apps/worker/wrangler.toml   # mailto:... 形式
```

ローカル開発では `apps/worker/.dev.vars` に同名のキーを設定する(`.dev.vars.example` 参照)。未設定の場合、`GET /api/push/public-key` は `{publicKey: null}` を返し、クライアントはページャー UI を表示しない。
