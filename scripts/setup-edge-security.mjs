import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/worker");
const wranglerToml = path.join(workerDir, "wrangler.toml");

const DEFAULT_HOST = "incident-training-worker.naokimiura15.workers.dev";
const DEFAULT_CUSTOM_HOST = "incident.thirdlf03.com";
const WIDGET_NAME = "incident-training session create";

function readAccountId() {
  const content = readFileSync(wranglerToml, "utf8");
  const match = content.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error("could not read account context from wrangler.toml");
  }
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? "bf2196e6a0e1ba61db76cf62ca00cafa";
}

function apiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    console.error("Set CLOUDFLARE_API_TOKEN with Account:Turnstile:Edit permission.");
    console.error("Your deploy token may need Turnstile:Edit added in the dashboard.");
    process.exit(1);
  }
  return token;
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

async function ensureWidgetSecret(token, accountId, widget) {
  console.log(`Syncing secret for widget ${widget.sitekey}...`);
  const rotated = await cfApi(
    token,
    "POST",
    `/accounts/${accountId}/challenges/widgets/${widget.sitekey}/rotate_secret`,
    { invalidate_immediately: true }
  );
  return { ...widget, secret: rotated.secret };
}

async function findExistingWidget(token, accountId, host) {
  const widgets = await cfApi(
    token,
    "GET",
    `/accounts/${accountId}/challenges/widgets`
  );
  return widgets.find(
    (widget) =>
      widget.name === WIDGET_NAME ||
      widget.domains?.includes(host)
  );
}

async function createWidget(token, accountId, host) {
  const domains = Array.from(
    new Set([host, DEFAULT_CUSTOM_HOST, "localhost", "127.0.0.1"])
  );
  return cfApi(token, "POST", `/accounts/${accountId}/challenges/widgets`, {
    name: WIDGET_NAME,
    mode: "invisible",
    domains,
  });
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

function putWranglerSecret(name, value) {
  run(
    "pnpm",
    [
      "exec",
      "wrangler",
      "secret",
      "put",
      name,
      "-c",
      "apps/worker/wrangler.toml",
    ],
    {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken(),
      },
    }
  );
}

function putGithubSecret(name, value) {
  run("gh", ["secret", "set", name, "--repo", "thirdlf03/hackz-alo"], {
    input: value,
  });
}

async function main() {
  const token = apiToken();
  const accountId = readAccountId();
  const host = process.env.INCIDENT_WORKER_HOST?.trim() || DEFAULT_HOST;

  console.log(`Using account ${accountId} and host ${host}`);

  let widget = await findExistingWidget(token, accountId, host);
  if (widget) {
    console.log(`Reusing Turnstile widget ${widget.sitekey}`);
    const domains = Array.from(
      new Set([
        ...(widget.domains ?? []),
        host,
        DEFAULT_CUSTOM_HOST,
        "localhost",
        "127.0.0.1",
      ])
    );
    if (domains.length !== (widget.domains ?? []).length) {
      widget = await cfApi(
        token,
        "PUT",
        `/accounts/${accountId}/challenges/widgets/${widget.sitekey}`,
        {
          name: widget.name,
          mode: widget.mode ?? "invisible",
          domains,
        }
      );
      console.log(`Turnstile domains updated: ${domains.join(", ")}`);
    }
  } else {
    widget = await createWidget(token, accountId, host);
    console.log(`Created Turnstile widget ${widget.sitekey}`);
  }

  if (!widget.sitekey) {
    throw new Error("Turnstile widget response missing sitekey");
  }
  widget = await ensureWidgetSecret(token, accountId, widget);

  if (!widget.secret) {
    throw new Error("Turnstile widget response missing secret");
  }

  console.log("Setting Worker secret TURNSTILE_SECRET_KEY...");
  putWranglerSecret("TURNSTILE_SECRET_KEY", widget.secret);

  console.log("Setting GitHub secret TURNSTILE_SITE_KEY...");
  putGithubSecret("TURNSTILE_SITE_KEY", widget.sitekey);

  console.log("");
  console.log("Turnstile is configured.");
  console.log(`Site key: ${widget.sitekey}`);
  console.log("");
  console.log("Next: redeploy so the web build embeds VITE_TURNSTILE_SITE_KEY.");
  console.log("  git tag v0.1.x && git push origin v0.1.x");
  console.log("");
  console.log("WAF note: not used; rely on Worker rate limits + Turnstile.");
  console.log("Security headers for HTML/JS are applied by the Worker (no Transform Rules needed).");
}

await main();
