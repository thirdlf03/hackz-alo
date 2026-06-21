#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { validateScenarioDefinition } from "@incident/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yamlDir = path.join(root, "packages/scenarios/scenarios");
const archivedYamlDir = path.join(yamlDir, "archived");
const jsonDir = path.join(root, "packages/scenarios/data");

const files = (await readdir(yamlDir)).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"));
if (files.length === 0) {
  console.error("no scenario yaml files found in", yamlDir);
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const raw = await readFile(path.join(yamlDir, file), "utf8");
  const scenario = parseYaml(raw);
  const result = validateScenarioDefinition(scenario);
  if (!result.ok) {
    failed = true;
    console.error(`${file}:`, result.errors.join("; "));
    continue;
  }
  const outName = `${scenario.id}.json`;
  await writeFile(path.join(jsonDir, outName), `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
  console.log(`wrote ${outName}`);
}

if (failed) process.exit(1);

const archivedFiles = (await readdir(archivedYamlDir).catch(() => [])).filter(
  (name) => name.endsWith(".yaml") || name.endsWith(".yml")
);
for (const file of archivedFiles) {
  const raw = await readFile(path.join(archivedYamlDir, file), "utf8");
  const scenario = parseYaml(raw);
  const result = validateScenarioDefinition(scenario);
  if (!result.ok) {
    failed = true;
    console.error(`archived/${file}:`, result.errors.join("; "));
  }
}
if (failed) process.exit(1);

console.log(`built ${files.length} scenarios (${archivedFiles.length} archived yaml validated)`);
