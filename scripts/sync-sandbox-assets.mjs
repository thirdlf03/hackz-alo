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
  await sandbox.writeFile(
    "/workspace/run/job-queue.jsonl",
    '{"id":"job-001","status":"pending"}\\n{"id":"job-002","status":"pending"}\\n'
  );
}
`;

writeFileSync(path.join(root, "apps/worker/src/sandbox/assets.ts"), output);
console.log(`synced ${assets.length} sandbox assets`);
