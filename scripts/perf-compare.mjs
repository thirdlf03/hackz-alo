import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';

const {comparePerfReports} = await tsImport(
  '../packages/observability/src/node/index.ts',
  import.meta.url
);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const baselinePath = readOption(args, '--baseline') ?? 'perf-baselines/main.json';
const currentPath = readOption(args, '--report') ?? 'perf-reports/report.json';

const current = existsSync(currentPath)
  ? JSON.parse(await readFile(currentPath, 'utf8'))
  : emptyReport();
const baseline = existsSync(baselinePath)
  ? JSON.parse(await readFile(baselinePath, 'utf8'))
  : undefined;
const result = comparePerfReports(current, baseline, {strict});

for (const finding of result.findings) console.log(finding);
if (!result.ok) process.exitCode = 1;

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function emptyReport() {
  return {
    generatedAt: new Date().toISOString(),
    spans: {count: 0, byName: []},
    marks: [],
    frames: {count: 0, p95DrawMs: 0, slowDrawCount: 0},
    benchmarks: {},
  };
}
