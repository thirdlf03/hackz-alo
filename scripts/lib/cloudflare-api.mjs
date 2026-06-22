import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wranglerToml = path.join(root, "apps/worker/wrangler.toml");

export const DEFAULT_ACCOUNT_ID = "bf2196e6a0e1ba61db76cf62ca00cafa";
export const DEFAULT_ZONE = "thirdlf03.com";
export const DEFAULT_HOST = `incident.${DEFAULT_ZONE}`;

export function apiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN. For setup:ops add Zone Health Checks Edit + Account Notifications Edit (+ Logs Edit for Logpush)."
    );
  }
  return token;
}

export function accountId() {
  return process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID;
}

export function workerHost() {
  return process.env.INCIDENT_WORKER_HOST?.trim() || DEFAULT_HOST;
}

export function zoneName() {
  return process.env.INCIDENT_ZONE?.trim() || DEFAULT_ZONE;
}

export async function cfApi(token, method, apiPath, body) {
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

export async function cfApiAllow404(token, method, apiPath, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (response.status === 404) return null;
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API ${method} ${apiPath} failed: ${JSON.stringify(payload.errors ?? payload)}`
    );
  }
  return payload.result;
}

export async function getZoneId(token, name = zoneName()) {
  const zones = await cfApi(token, "GET", `/zones?name=${encodeURIComponent(name)}`);
  const zone = zones[0];
  if (!zone) {
    throw new Error(`Zone ${name} not found on this account.`);
  }
  return zone;
}

export function readWranglerName() {
  const content = readFileSync(wranglerToml, "utf8");
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? "incident-training-worker";
}
