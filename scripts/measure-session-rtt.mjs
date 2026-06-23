const BASE_URL = 'http://127.0.0.1:5173';
const SAMPLES = 20;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? 0;
}

async function waitForReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/scenarios`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('dev server did not become ready');
}

async function timedGet(path, headers = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {headers});
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const body = await response.json().catch(() => ({}));
  return {response, elapsedMs, body};
}

async function main() {
  await waitForReady();

  const created = await timedGet('/api/scenarios');
  if (!created.response.ok) {
    throw new Error(`scenarios failed: ${created.response.status}`);
  }

  const sessionStarted = performance.now();
  const create = await fetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({difficulty: 'beginner'}),
  });
  const createBody = await create.json();
  if (!create.ok || !createBody.ok) {
    throw new Error(`session create failed: ${create.status} ${JSON.stringify(createBody)}`);
  }

  const {sessionId, writeToken} = createBody.data;
  const auth = {authorization: `Bearer ${writeToken}`};

  const start = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...auth},
    body: '{}',
  });
  const startBody = await start.json();
  if (!start.ok || !startBody.ok) {
    throw new Error(`session start failed: ${start.status} ${JSON.stringify(startBody)}`);
  }

  const clockRtts = [];
  const metricsRtts = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const clock = await timedGet(
      `/api/sessions/${encodeURIComponent(sessionId)}/clock`,
      auth
    );
    if (!clock.response.ok) {
      throw new Error(`clock failed: ${clock.response.status}`);
    }
    clockRtts.push(clock.elapsedMs);

    if (i % 2 === 0) {
      const metrics = await timedGet(
        `/api/sessions/${encodeURIComponent(sessionId)}/metrics`,
        auth
      );
      if (metrics.response.ok) {
        metricsRtts.push(metrics.elapsedMs);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const simApiP95 = startBody.data?.session ? undefined : undefined;
  let latestMetrics;
  const metricsSample = await timedGet(
    `/api/sessions/${encodeURIComponent(sessionId)}/metrics`,
    auth
  );
  if (metricsSample.response.ok && metricsSample.body.ok) {
    latestMetrics = metricsSample.body.data;
  }

  const summary = (label, values) => ({
    label,
    count: values.length,
    minMs: Math.min(...values),
    avgMs: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
  });

  const result = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    sessionId,
    sessionStartMs: Math.round(performance.now() - sessionStarted),
    sessionRtt: summary('GET /clock (Session RTT)', clockRtts),
    metricsFetch: summary('GET /metrics (includes sandbox exec)', metricsRtts),
    latestSimApiP95Ms: latestMetrics?.latencyP95Ms ?? null,
    note:
      'Session RTT matches the new NETWORK card. Sim API p95 is the in-sandbox fictional metric.',
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
