import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountId,
  apiToken,
  cfApi,
  getZoneId,
  readWranglerName,
  workerHost,
  zoneName,
} from "./lib/cloudflare-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const host = workerHost();

function shouldRun(flag) {
  return runAll || args.has(flag);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function permissionHint(step, error) {
  const message = String(error?.message ?? error);
  if (!message.includes("Authentication error") && !message.includes("10000")) {
    return;
  }
  console.error("\nPermission hint for", step + ":");
  if (step.includes("Health")) {
    console.error("  Zone → Health Checks → Edit (scope: thirdlf03.com)");
    console.error("  Account → Notifications → Edit");
  }
  if (step.includes("Usage")) {
    console.error("  Account → Notifications → Edit");
  }
  if (step.includes("Logpush")) {
    console.error("  Account → Logs → Edit");
  }
  console.error(
    "  Dashboard: My Profile → API Tokens → edit deploy token → Add permissions"
  );
  console.error("  Or create a one-off token with the permissions above.");
}

async function runStep(label, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    console.error(`\nFAILED: ${label}`);
    console.error(error instanceof Error ? error.message : error);
    permissionHint(label, error);
    return false;
  }
}

async function setupAdminSecret() {
  console.log("\n=== ADMIN_SECRET ===");
  const secret =
    process.env.ADMIN_SECRET?.trim() ?? randomBytes(32).toString("hex");

  run(
    "pnpm",
    [
      "exec",
      "wrangler",
      "secret",
      "put",
      "ADMIN_SECRET",
      "-c",
      "apps/worker/wrangler.toml",
    ],
    {
      input: secret,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: apiToken() },
    }
  );

  run(
    "gh",
    [
      "secret",
      "set",
      "INCIDENT_ADMIN_SECRET",
      "--repo",
      "thirdlf03/hackz-alo",
      "--body",
      secret,
    ],
    { stdio: "inherit" }
  );

  console.log("ADMIN_SECRET set on Worker and INCIDENT_ADMIN_SECRET in GitHub.");
  console.log(
    `Use: curl -H 'x-admin-secret: <secret>' https://${host}/api/admin/...`
  );
}

async function setupHealthCheck(token, zoneId) {
  console.log("\n=== Health check + notification ===");
  const checks = await cfApi(token, "GET", `/zones/${zoneId}/healthchecks`);
  const name = "incident-training /api/ready";
  let healthCheck = checks.find((item) => item.name === name);

  if (!healthCheck) {
    healthCheck = await cfApi(token, "POST", `/zones/${zoneId}/healthchecks`, {
      name,
      address: host,
      type: "HTTPS",
      description: "Incident training Worker readiness",
      interval: 60,
      retries: 2,
      timeout: 5,
      check_regions: ["WNAM", "ENAM", "WEU", "SEAS"],
      http_config: {
        method: "GET",
        path: "/api/ready",
        expected_codes: ["200"],
        follow_redirects: true,
        allow_insecure: false,
      },
    });
    console.log(`Created health check ${healthCheck.id}`);
  } else {
    console.log(`Reusing health check ${healthCheck.id}`);
  }

  const email = process.env.ALERT_EMAIL?.trim();
  if (!email) {
    console.warn("Set ALERT_EMAIL to auto-create health_check_status_notification.");
    return healthCheck;
  }

  const policies = await cfApi(
    token,
    "GET",
    `/accounts/${accountId()}/alerting/v3/policies`
  );
  const policyName = "incident-training health check";
  const exists = policies.some((policy) => policy.name === policyName);
  if (exists) {
    console.log("Health check notification policy already exists.");
    return healthCheck;
  }

  await cfApi(token, "POST", `/accounts/${accountId()}/alerting/v3/policies`, {
    name: policyName,
    description: "Alert when /api/ready health check fails",
    enabled: true,
    alert_type: "health_check_status_notification",
    mechanisms: { email: [{ id: email }] },
    filters: {
      health_check_id: [healthCheck.id],
      status: ["Unhealthy"],
    },
  });
  console.log(`Created health check notification for ${email}`);
  return healthCheck;
}

async function setupUsageNotifications(token) {
  console.log("\n=== Usage notifications (Workers / R2 / D1) ===");
  const email = process.env.ALERT_EMAIL?.trim();
  if (!email) {
    console.warn("Set ALERT_EMAIL to auto-create billing_usage_alert policies.");
    return;
  }

  const policies = await cfApi(
    token,
    "GET",
    `/accounts/${accountId()}/alerting/v3/policies`
  );
  const targets = [
    { product: "workers", limit: "1000000", name: "incident workers requests" },
    { product: "r2", limit: "1073741824", name: "incident r2 egress 1GB" },
    { product: "d1", limit: "10000000", name: "incident d1 rows read" },
  ];

  for (const target of targets) {
    if (policies.some((policy) => policy.name === target.name)) {
      console.log(`Skip existing policy: ${target.name}`);
      continue;
    }
    await cfApi(token, "POST", `/accounts/${accountId()}/alerting/v3/policies`, {
      name: target.name,
      description: `Usage alert for ${target.product}`,
      enabled: true,
      alert_type: "billing_usage_alert",
      mechanisms: { email: [{ id: email }] },
      filters: {
        product: [target.product],
        limit: [target.limit],
      },
    });
    console.log(`Created usage notification: ${target.name}`);
  }
}

async function setupLogpush(token) {
  console.log("\n=== Workers Logpush ===");
  const r2KeyId = process.env.R2_LOGPUSH_ACCESS_KEY_ID?.trim();
  const r2Secret = process.env.R2_LOGPUSH_SECRET_ACCESS_KEY?.trim();
  const bucket =
    process.env.R2_LOGPUSH_BUCKET?.trim() || "incident-training-replays";
  const prefix = process.env.R2_LOGPUSH_PREFIX?.trim() || "logs/workers";

  if (!r2KeyId || !r2Secret) {
    console.log("Skipped API setup (no R2_LOGPUSH_ACCESS_KEY_ID / R2_LOGPUSH_SECRET_ACCESS_KEY).");
    console.log("Dashboard: Account → Analytics & Logs → Logpush → Create");
    console.log("  Dataset: Workers trace events");
    console.log(`  Destination: R2 → bucket ${bucket}/${prefix}/{{DATE}}`);
    console.log("Then redeploy Worker (wrangler.toml has logpush = true).");
    return;
  }

  const jobs = await cfApi(
    token,
    "GET",
    `/accounts/${accountId()}/logpush/jobs?dataset=workers_trace_events`
  );
  const jobName = "incident-training-worker-logs";
  if (jobs.some((job) => job.name === jobName)) {
    console.log("Workers Logpush job already exists.");
    return;
  }

  const destination = `r2://${bucket}/${prefix}/{DATE}?account-id=${accountId()}&access-key-id=${r2KeyId}&secret-access-key=${r2Secret}`;
  await cfApi(token, "POST", `/accounts/${accountId()}/logpush/jobs`, {
    name: jobName,
    dataset: "workers_trace_events",
    enabled: true,
    destination_conf: destination,
    output_options: {
      field_names: [
        "Event",
        "EventTimestampMs",
        "Outcome",
        "Exceptions",
        "Logs",
        "ScriptName",
      ],
      timestamp_format: "rfc3339",
    },
  });
  console.log("Created Workers Logpush job. Redeploy Worker to enable logpush = true.");
}

function printAccessGuide() {
  console.log("\n=== Cloudflare Access (dashboard, ~5 min) ===");
  console.log("1. Zero Trust → Access → Applications → Add application");
  console.log(`2. Self-hosted → Domain: ${host} → Path: /api/admin/*`);
  console.log("3. Policy: Allow → your email (or service token for CI)");
  console.log("4. Optional: repeat for /api/dev/*");
  console.log("5. Test:");
  console.log(`   curl -i https://${host}/api/admin/replays/test/featured  # expect 401`);
  console.log(
    "   Open same URL in browser after Access login → 404 (replay missing) is OK"
  );
}

async function main() {
  const token = apiToken();
  const zone = await getZoneId(token, zoneName());
  console.log(`Account ${accountId()}, zone ${zone.name} (${zone.id}), host ${host}`);
  console.log(`Worker ${readWranglerName()}`);

  const failures = [];

  if (shouldRun("--admin")) {
    try {
      await setupAdminSecret();
    } catch (error) {
      failures.push("--admin");
      console.error("\nFAILED: ADMIN_SECRET");
      console.error(error instanceof Error ? error.message : error);
    }
  }
  if (shouldRun("--health")) {
    if (!(await runStep("Health check + notification", () => setupHealthCheck(token, zone.id)))) {
      failures.push("--health");
    }
  }
  if (shouldRun("--notify")) {
    if (!(await runStep("Usage notifications", () => setupUsageNotifications(token)))) {
      failures.push("--notify");
    }
  }
  if (shouldRun("--logpush")) {
    if (!(await runStep("Workers Logpush", () => setupLogpush(token)))) {
      failures.push("--logpush");
    }
  }
  if (shouldRun("--access-guide") || runAll) {
    printAccessGuide();
  }

  if (failures.length > 0) {
    console.error(`\nCompleted with failures: ${failures.join(", ")}`);
    console.error("Retry after fixing token permissions, e.g.:");
    console.error(`  pnpm run setup:ops -- ${failures.join(" ")}`);
    process.exit(1);
  }

  console.log("\nDone. Run load test:");
  console.log(`  INCIDENT_WORKER_URL=https://${host} pnpm run load-test`);
}

await main();
