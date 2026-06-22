const baseUrl = (
  process.env.INCIDENT_WORKER_URL ?? "https://incident.thirdlf03.com"
).replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, init = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const elapsedMs = Math.round(performance.now() - started);
  return { response, elapsedMs };
}

async function testReady() {
  console.log("\n[1/4] GET /api/ready");
  const { response, elapsedMs } = await request("/api/ready");
  assert(response.status === 200, `expected 200, got ${response.status}`);
  console.log(`  OK ${elapsedMs}ms`);
}

async function testSessionRateLimit() {
  console.log("\n[2/4] POST /api/sessions rate limit (expect 429 after 5/min/IP)");
  const statuses = [];
  for (let i = 0; i < 10; i += 1) {
    const { response } = await request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty: "beginner" }),
    });
    statuses.push(response.status);
  }
  const rateLimited = statuses.filter((status) => status === 429).length;
  const forbidden = statuses.filter((status) => status === 403).length;
  assert(rateLimited >= 4, `expected >=4x 429, got ${JSON.stringify(statuses)}`);
  console.log(`  statuses: ${statuses.join(", ")}`);
  console.log(`  OK (${forbidden} turnstile 403, ${rateLimited} rate limit 429)`);
}

async function testAdminUnauthorized() {
  console.log("\n[3/4] POST /api/admin without secret (expect 401)");
  const { response } = await request("/api/admin/replays/repl_test/featured", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ featured: true }),
  });
  assert(response.status === 401, `expected 401, got ${response.status}`);
  console.log("  OK");
}

async function testScenariosLatency() {
  console.log("\n[4/4] GET /api/scenarios latency (5 requests)");
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const { response, elapsedMs } = await request("/api/scenarios");
    assert(response.status === 200, `expected 200, got ${response.status}`);
    samples.push(elapsedMs);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
  console.log(`  latencies ms: ${samples.join(", ")} (p95~${p95})`);
  if (p95 > 3000) {
    console.warn("  WARN: p95 > 3000ms (observability threshold)");
  } else {
    console.log("  OK");
  }
}

async function main() {
  console.log(`Load test against ${baseUrl}`);
  await testReady();
  await testSessionRateLimit();
  await testAdminUnauthorized();
  await testScenariosLatency();
  console.log("\nAll automated checks passed.");
  console.log("Manual (see docs/production/load-test.md):");
  console.log("  - Sandbox 6th session → 503");
  console.log("  - Replay finalize with 360 chunks");
}

await main();
