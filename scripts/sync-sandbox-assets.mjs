import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readSandboxAssets,
  writeSandboxAssetsTs,
} from "./lib/sandbox-assets-codegen.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
writeSandboxAssetsTs(root);
console.log(`synced ${readSandboxAssets(root).length} sandbox assets`);
