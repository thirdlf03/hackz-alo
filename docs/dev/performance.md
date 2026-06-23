# Local App Perf Observability

Perf observability v1 is local-only. It is meant to compare app behavior during
development and does not send telemetry to a production collector.

## Enable

- Worker/runtime spans: `INCIDENT_PERF=1`
- Browser spans and overlay: `VITE_INCIDENT_PERF=1` or `?perf=1`
- Console exporter: use `INCIDENT_PERF=console` or `VITE_INCIDENT_PERF=console`

The browser exposes `window.__incidentPerf.snapshot()` only while perf is
enabled. The snapshot contains app spans, journey marks, frame samples, and
browser `performance.mark` / `performance.measure` entries.

## Overlay

When browser perf is enabled, the play canvas shows `DEV PERF` in the top-right.
It reports FPS, last draw time, draw p95, slow draw count, and the latest
journey mark. The overlay is dev-only and is not part of the game’s simulated
service metrics.

## Naming

Application perf spans use the `incident.app.*` namespace:

- `incident.app.http.request`
- `incident.app.api.request`
- `incident.app.do.request`
- `incident.app.do.snapshot_poll`
- `incident.app.d1.query`
- `incident.app.sandbox.prepare`
- `incident.app.sandbox.exec`
- `incident.app.canvas.draw`

Game-world metrics keep their existing domain vocabulary, such as
`MetricsSnapshot`, `latencyP95Ms`, and `SERVICE HEALTH`. Do not use those names
for app perf spans.

## Journey Marks

The browser records these local marks:

- `incident.app.journey.scenarios_loaded`
- `incident.app.journey.session_created`
- `incident.app.journey.briefing_ready`
- `incident.app.journey.game_started`
- `incident.app.journey.canvas_first_draw`
- `incident.app.journey.terminal_ready`
- `incident.app.journey.recording_chunk_uploaded`

Canvas frames are sampled every draw for the overlay, but spans are emitted only
for first draw and slow draw/tick paths.

## Sandbox Preflight

Session creation schedules a best-effort sandbox preflight while the user is on
the briefing screen. Preflight starts the sandbox container, installs workspace
assets, runs the setup cleanup, and writes a scenario marker. Starting the game
waits for any in-flight preflight and then rechecks the marker before launching
scenario processes.

Preflight reduces user-visible start latency when the container can warm during
briefing. It does not force Cloudflare placement; deployment still needs Worker,
Durable Object, D1, and container placement to be kept close to the target user
population.

During play, the metrics panel shows **Session RTT**: browser round-trip time to
`GET /api/sessions/:id/clock` (edge + Session DO). The **Sim API p95** card is
still the in-sandbox fictional service latency used by scenarios.

The sandbox `sleepAfter` default is `16m`, matching the 15-minute briefing
timeout with a small buffer. Override it with `INCIDENT_SANDBOX_SLEEP_AFTER`
when testing cost/latency tradeoffs.

## Commands

- `pnpm run perf:bench`: benchmarks pure app functions and writes
  `.perf/bench.json`
- `pnpm run perf:e2e`: starts local dev with perf enabled, runs the focused
  Playwright journey, and writes `.perf/traces.jsonl`
- `pnpm run perf:report`: builds `perf-reports/report.json` and
  `perf-reports/report.md`
- `pnpm run perf:compare`: compares the current report to
  `perf-baselines/main.json` when it exists
- `pnpm run perf:placement:verify`: prints D1/container region settings and
  compares placement baselines (default:
  `perf-baselines/placement-before.json` vs `perf-reports/report.json`)

`perf:compare` exits 0 when no baseline is present. Add `-- --strict` when a
baseline exists and perf regressions should fail the command.

## Artifacts

Generated output is intentionally ignored by git:

- `.perf/`
- `.perf-prod/`
- `perf-reports/`

`perf-baselines/main.json` can be added later as an optional comparison target.
It is not required for local development or CI.

## APAC Placement Verification (Japan users)

Target audience is Japan-only. Placement changes pin Session Durable Objects to
`apac-ne` and restrict sandbox containers to the `APAC` region.

### Baselines

- `perf-baselines/placement-before.json`: local perf journey before APAC
  constraints (captured after sandbox preflight landed).
- `perf-baselines/placement-after.json`: same local journey after APAC deploy
  (not a production browser run).

Key spans to compare:

- `incident.app.sandbox.prepare` (cold: `cached: false`)
- `incident.app.sandbox.start`
- Journey marks: `briefing_ready` → `game_started`

### Capture a baseline

```sh
pnpm run perf:e2e
pnpm run perf:report
cp perf-reports/report.json perf-baselines/placement-before.json
```

### Infrastructure snapshot (before APAC constraints)

Recorded 2026-06-22:

```sh
cd apps/worker
pnpm exec wrangler d1 info incident-training --json
# running_in_region: APAC

pnpm exec wrangler containers info a036649d-ced0-4765-ad6f-aba55b537101
# constraints.regions: not set (tiers only)

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/incident-training-worker/settings" \
  | jq .result.placement
# {}
```

### After deploy checklist (local + infra)

All steps below use **local** `perf:e2e` / `perf:report` and `wrangler` CLI
against the deployed account. There is no automated production browser journey
(Turnstile blocks headless/CI against the live site).

1. `wrangler containers info` shows `constraints.regions` includes `APAC`.
2. `wrangler d1 info` still shows `running_in_region: APAC`.
3. New session only (existing DOs do not relocate).
4. `pnpm run perf:placement:verify` compares local before/after reports.

### Local success criteria (perf:e2e)

| Metric                                  | Target                                 |
| --------------------------------------- | -------------------------------------- |
| cold `sandbox.prepare` p95              | &lt; 2500ms or 30%+ better than before |
| `sandbox.start` p95                     | &lt; 2500ms                            |
| warm `sandbox.prepare` (`cached: true`) | &lt; 200ms                             |

### Recorded snapshot (2026-06-22, local dev)

After APAC constraints + `apac-ne` deploy (`654f56ff`), infra + local journey:

- `wrangler containers info`: `constraints.regions = ["APAC"]`
- `wrangler d1 info`: `running_in_region = APAC`
- `pnpm run perf:placement:verify`: no span p95 regressions vs
  `placement-before.json`; `sandbox.start` p95 ~1989ms; worker HTTP spans
  report `incident.cf.colo = KIX` during local dev.
