import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerToml = path.join(root, "apps/worker/wrangler.toml");
const DEFAULT_ZONE = "thirdlf03.com";
const DEFAULT_HOST = `incident.${DEFAULT_ZONE}`;
const WIDGET_NAME = "incident-training session create";

function apiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    console.error("Set CLOUDFLARE_API_TOKEN (Zone:Read + Turnstile:Edit).");
    process.exit(1);
  }
  return token;
}

function accountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? "bf2196e6a0e1ba61db76cf62ca00cafa";
}

async function cfApi(token, method, apiPath, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API ${method} ${apiPath} failed: ${JSON.stringify(payload.errors ?? payload)}`
    );
  }
  return payload.result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function findTurnstileWidget(token, accountIdValue, host) {
  const widgets = await cfApi(
    token,
    "GET",
    `/accounts/${accountIdValue}/challenges/widgets`
  );
  return widgets.find(
    (widget) =>
      widget.name === WIDGET_NAME || widget.domains?.includes(host)
  );
}

async function main() {
  const token = apiToken();
  const zoneName = process.env.INCIDENT_ZONE?.trim() || DEFAULT_ZONE;
  const host = process.env.INCIDENT_WORKER_HOST?.trim() || DEFAULT_HOST;
  const accountIdValue = accountId();

  console.log(`Checking zone ${zoneName}...`);
  const zones = await cfApi(
    token,
    "GET",
    `/zones?name=${encodeURIComponent(zoneName)}`
  );
  const zone = zones[0];
  if (!zone) {
    throw new Error(
      `${zoneName} is not on this Cloudflare account. Add the zone first.`
    );
  }
  console.log(`Zone OK: ${zone.name} (${zone.id}, status=${zone.status})`);

  const wrangler = readFileSync(wranglerToml, "utf8");
  if (!wrangler.includes(`pattern = "${host}"`)) {
    console.warn(
      `wrangler.toml does not list ${host} yet. Deploy after pulling latest main.`
    );
  }

  const widget = await findTurnstileWidget(token, accountIdValue, host);
  if (widget) {
    const domains = Array.from(
      new Set([
        ...(widget.domains ?? []),
        host,
        zoneName,
        "localhost",
        "127.0.0.1",
      ])
    );
    await cfApi(
      token,
      "PUT",
      `/accounts/${accountIdValue}/challenges/widgets/${widget.sitekey}`,
      {
        name: widget.name,
        mode: widget.mode ?? "invisible",
        domains,
      }
    );
    console.log(`Turnstile domains updated: ${domains.join(", ")}`);
  } else {
    console.warn("Turnstile widget not found. Run pnpm run setup:edge first.");
  }

  console.log(`Setting GitHub secret INCIDENT_WORKER_URL=https://${host} ...`);
  run("gh", [
    "secret",
    "set",
    "INCIDENT_WORKER_URL",
    "--repo",
    "thirdlf03/hackz-alo",
    "--body",
    `https://${host}`,
  ]);

  console.log("");
  console.log("Next steps:");
  console.log(`  1. pnpm run deploy   # creates Custom Domain ${host}`);
  console.log(`  2. Open https://${host}/api/ready`);
  console.log("  3. Configure Billing alerts (see docs/production/cloudflare-edge.md)");
}

await main();
