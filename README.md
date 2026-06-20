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
- `tests`: dependency-light unit and smoke tests

## Local Checks

```sh
npm test
```

Install workspace dependencies before running the Vite/Worker dev servers:

```sh
npm install
npm run dev:web
npm run dev:worker
```

## Deploy (Worker + static frontend)

Production serves the Vite build from the same Worker as the API (`/api/*`).
Local development still uses separate Vite and Worker dev servers.

One-time Cloudflare setup:

```sh
wrangler login
npm run setup:cloudflare
npm run db:migrate:remote
```

Deploy:

```sh
npm run deploy
```

`npm run deploy` builds scenarios, builds `apps/web/dist`, then runs `wrangler deploy`.
R2 bucket creation and container image upload are handled by Wrangler during deploy.
