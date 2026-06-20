import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDist = path.join(root, "apps/web/dist/index.html");
const wranglerToml = path.join(root, "apps/worker/wrangler.toml");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const wranglerConfig = readFileSync(wranglerToml, "utf8");
if (wranglerConfig.includes('database_id = "local-development"')) {
  console.error("wrangler.toml still uses local-development D1 id.");
  console.error("Run `npm run setup:cloudflare` before deploying.");
  process.exit(1);
}

if (wranglerConfig.includes('id = "local-development"')) {
  console.error("wrangler.toml still uses local-development KV id.");
  console.error("Run `npm run setup:cloudflare` before deploying.");
  process.exit(1);
}

run("npm", ["run", "build:scenarios"]);
run("npm", ["--workspace", "apps/web", "run", "build"]);

if (!existsSync(webDist)) {
  console.error(`missing frontend build output: ${webDist}`);
  process.exit(1);
}

run("npm", ["--workspace", "apps/worker", "run", "deploy"]);
