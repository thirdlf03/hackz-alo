import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetsTsPath,
  normalizeGeneratedSource,
  readFormattedSandboxAssetsTs,
} from "./lib/sandbox-assets-codegen.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsPath = assetsTsPath(root);
const expected = readFormattedSandboxAssetsTs(root);
const actual = normalizeGeneratedSource(readFileSync(assetsPath, "utf8"));

if (actual === expected) {
  console.log("sandbox assets are in sync");
  process.exit(0);
}

console.error(
  "sandbox assets are out of sync with sandbox/ source files.\n" +
    `expected generated file: ${assetsPath}\n` +
    "run: pnpm run sync:sandbox-assets"
);
process.exit(1);
