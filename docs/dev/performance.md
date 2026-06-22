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

`perf:compare` exits 0 when no baseline is present. Add `-- --strict` when a
baseline exists and perf regressions should fail the command.

## Artifacts

Generated output is intentionally ignored by git:

- `.perf/`
- `perf-reports/`

`perf-baselines/main.json` can be added later as an optional comparison target.
It is not required for local development or CI.
