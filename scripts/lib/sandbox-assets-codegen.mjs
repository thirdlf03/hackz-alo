import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const SANDBOX_ASSET_FILES = [
  ["services/metrics/collector.mjs", "/workspace/services/metrics/collector.mjs"],
  ["services/metrics/export.mjs", "/workspace/services/metrics/export.mjs"],
  ["services/yamabiko-api/server.mjs", "/workspace/services/yamabiko-api/server.mjs"],
  ["services/fake-db/server.mjs", "/workspace/services/fake-db/server.mjs"],
  ["bin/fault-injector.mjs", "/workspace/bin/fault-injector.mjs"],
  ["bin/yamactl.mjs", "/workspace/bin/yamactl.mjs"],
  ["bin/kodama.mjs", "/workspace/bin/kodama.mjs"],
  ["services/batch/sales.kdm", "/workspace/services/batch/sales.kdm"],
];

export const ASSETS_TS_RELATIVE_PATH = "apps/worker/src/sandbox/assets.ts";

const INSTALL_BIN_COMMAND =
  "chmod +x /workspace/bin/*.mjs && " +
  "printf '%s\\n' '#!/bin/sh' 'exec node /workspace/bin/yamactl.mjs \"$@\"' > /usr/local/bin/yamactl && " +
  "printf '%s\\n' '#!/bin/sh' 'exec node /workspace/bin/kodama.mjs \"$@\"' > /usr/local/bin/kodama && " +
  "chmod +x /usr/local/bin/yamactl /usr/local/bin/kodama";

export function sandboxAssetPath(root = defaultRoot, relativePath) {
  return path.join(root, "sandbox", relativePath);
}

export function assetsTsPath(root = defaultRoot) {
  return path.join(root, ASSETS_TS_RELATIVE_PATH);
}

export function readSandboxAssets(root = defaultRoot) {
  const assets = [];
  for (const [relativePath, targetPath] of SANDBOX_ASSET_FILES) {
    const sourcePath = sandboxAssetPath(root, relativePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`missing sandbox source file: ${relativePath}`);
    }
    assets.push({
      path: targetPath,
      content: readFileSync(sourcePath, "utf8"),
    });
  }
  return assets;
}

export function buildSandboxAssetsTs(root = defaultRoot) {
  const assets = readSandboxAssets(root);
  return `import type { SandboxRuntime } from "./runtime.js";

interface SandboxAsset {
  path: string;
  content: string;
}

const assets: SandboxAsset[] = ${JSON.stringify(assets, null, 2)};

export async function installSandboxAssets(sandbox: SandboxRuntime) {
  await sandbox.exec("mkdir -p /workspace/services/metrics /workspace/services/yamabiko-api /workspace/services/fake-db /workspace/services/batch /workspace/bin /workspace/logs /workspace/run");
  for (const asset of assets) {
    await sandbox.writeFile(asset.path, asset.content);
  }
  await sandbox.exec(${JSON.stringify(INSTALL_BIN_COMMAND)});
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
}

export function normalizeGeneratedSource(source) {
  return source.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

export function formatSandboxAssetsFile(filePath, root = defaultRoot) {
  const result = spawnSync("pnpm", ["exec", "oxfmt", filePath], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || "oxfmt failed while formatting sandbox assets"
    );
  }
}

export function writeSandboxAssetsTs(root = defaultRoot) {
  const outputPath = assetsTsPath(root);
  writeFileSync(outputPath, normalizeGeneratedSource(buildSandboxAssetsTs(root)));
  formatSandboxAssetsFile(outputPath, root);
  return outputPath;
}

export function readFormattedSandboxAssetsTs(root = defaultRoot) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "sandbox-assets-"));
  const tmpPath = path.join(tmpDir, "assets.ts");
  try {
    writeFileSync(
      tmpPath,
      normalizeGeneratedSource(buildSandboxAssetsTs(root))
    );
    formatSandboxAssetsFile(tmpPath, root);
    return normalizeGeneratedSource(readFileSync(tmpPath, "utf8"));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
