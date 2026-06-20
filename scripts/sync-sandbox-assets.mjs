import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["services/metrics/collector.mjs", "/workspace/services/metrics/collector.mjs"],
  ["services/unyoh-api/server.mjs", "/workspace/services/unyoh-api/server.mjs"],
  ["services/fake-db/server.mjs", "/workspace/services/fake-db/server.mjs"],
  ["bin/fault-injector.mjs", "/workspace/bin/fault-injector.mjs"],
  ["bin/unctl.mjs", "/workspace/bin/unctl.mjs"],
  ["bin/unlang.mjs", "/workspace/bin/unlang.mjs"],
  ["services/batch/sales.un", "/workspace/services/batch/sales.un"]
];

const assets = files.map(([relativePath, targetPath]) => ({
  path: targetPath,
  content: readFileSync(path.join(root, "sandbox", relativePath), "utf8")
}));

const installBinCommand =
  "chmod +x /workspace/bin/*.mjs && " +
  "printf '%s\\n' '#!/bin/sh' 'exec node /workspace/bin/unctl.mjs \"$@\"' > /usr/local/bin/unctl && " +
  "printf '%s\\n' '#!/bin/sh' 'exec node /workspace/bin/unlang.mjs \"$@\"' > /usr/local/bin/unlang && " +
  "chmod +x /usr/local/bin/unctl /usr/local/bin/unlang";

const output = `import type { SandboxRuntime } from "./runtime.js";

type SandboxAsset = {
  path: string;
  content: string;
};

const assets: SandboxAsset[] = ${JSON.stringify(assets, null, 2)};

export async function installSandboxAssets(sandbox: SandboxRuntime) {
  await sandbox.exec("mkdir -p /workspace/services/metrics /workspace/services/unyoh-api /workspace/services/fake-db /workspace/services/batch /workspace/bin /workspace/logs /workspace/run");
  for (const asset of assets) {
    await sandbox.writeFile(asset.path, asset.content);
  }
  await sandbox.exec(${JSON.stringify(installBinCommand)});
  await sandbox.exec(
    "if ! command -v vim >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends vim && rm -rf /var/lib/apt/lists/*; elif command -v apk >/dev/null 2>&1; then apk add --no-cache vim; fi; fi",
    { cwd: "/workspace" }
  );
  await sandbox.writeFile(
    "/workspace/run/job-queue.jsonl",
    '{"id":"job-001","status":"pending"}\\n{"id":"job-002","status":"pending"}\\n'
  );
}
`;

writeFileSync(path.join(root, "apps/worker/src/sandbox/assets.ts"), output);
console.log(`synced ${assets.length} sandbox assets`);
