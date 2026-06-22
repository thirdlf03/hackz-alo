import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/worker");
const wranglerToml = path.join(workerDir, "wrangler.toml");

function runWrangler(args) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: workerDir,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function replaceTomlValue(content, key, value) {
  const pattern = new RegExp(`^(${key}\\s*=\\s*")[^"]+(")$`, "m");
  if (!pattern.test(content)) {
    throw new Error(`could not find ${key} in wrangler.toml`);
  }
  return content.replace(pattern, `$1${value}$2`);
}

let content = readFileSync(wranglerToml, "utf8");
let changed = false;

if (content.includes('database_id = "local-development"')) {
  console.log("Creating D1 database incident-training...");
  const output = runWrangler(["d1", "create", "incident-training"]);
  const match = output.match(/database_id\s*=\s*"([^"]+)"/);
  if (!match) {
    console.error("Could not parse database_id from wrangler output.");
    process.exit(1);
  }
  content = replaceTomlValue(content, "database_id", match[1]);
  changed = true;
  console.log(`Updated D1 database_id to ${match[1]}`);
}

if (content.includes('id = "local-development"')) {
  console.log("Creating KV namespace SCENARIO_KV...");
  const output = runWrangler(["kv", "namespace", "create", "SCENARIO_KV"]);
  const match = output.match(/id\s*=\s*"([^"]+)"/);
  if (!match) {
    console.error("Could not parse KV namespace id from wrangler output.");
    process.exit(1);
  }
  content = replaceTomlValue(content, "id", match[1]);
  changed = true;
  console.log(`Updated SCENARIO_KV id to ${match[1]}`);
}

if (changed) {
  writeFileSync(wranglerToml, content);
}

console.log("");
console.log("Cloudflare resource IDs are configured in apps/worker/wrangler.toml.");
console.log("Next steps:");
console.log("  1. wrangler login   (or set CLOUDFLARE_API_TOKEN)");
console.log("  2. pnpm run db:migrate:remote");
console.log("  3. pnpm run deploy");
