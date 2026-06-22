import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(root, 'apps/worker');
const {comparePerfReports} = await tsImport(
  '../packages/observability/src/node/index.ts',
  import.meta.url
);

const args = process.argv.slice(2);
const baselinePath =
  readOption(args, '--baseline') ??
  path.join(root, 'perf-baselines/placement-before.json');
const reportPath =
  readOption(args, '--report') ?? path.join(root, 'perf-reports/report.json');
const containerId =
  process.env.INCIDENT_SANDBOX_CONTAINER_ID ??
  'a036649d-ced0-4765-ad6f-aba55b537101';

console.log('=== APAC placement infrastructure ===');
printWranglerJson(['d1', 'info', 'incident-training', '--json']);
printWranglerJson(['containers', 'info', containerId]);

console.log('\n=== Perf report comparison ===');
const current = existsSync(reportPath)
  ? JSON.parse(await readFile(reportPath, 'utf8'))
  : undefined;
const baseline = existsSync(baselinePath)
  ? JSON.parse(await readFile(baselinePath, 'utf8'))
  : undefined;

if (!current) {
  console.error(`missing report: ${reportPath}`);
  process.exitCode = 1;
} else {
  printSpanSummary('current', current);
}
if (baseline) {
  printSpanSummary('baseline', baseline);
} else {
  console.log(`baseline not found: ${baselinePath}`);
}

const result = comparePerfReports(current ?? emptyReport(), baseline, {
  strict: args.includes('--strict'),
});
for (const finding of result.findings) console.log(finding);
if (!result.ok) process.exitCode = 1;

function printWranglerJson(wranglerArgs) {
  const run = spawnSync('pnpm', ['exec', 'wrangler', ...wranglerArgs], {
    cwd: workerDir,
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    return;
  }
  try {
    const payload = JSON.parse(run.stdout);
    if (wranglerArgs[0] === 'd1') {
      console.log(`D1 region: ${payload.running_in_region ?? 'unknown'}`);
      return;
    }
    if (wranglerArgs[0] === 'containers') {
      const regions = payload.constraints?.regions;
      console.log(
        `Container regions: ${
          Array.isArray(regions) && regions.length > 0
            ? regions.join(', ')
            : 'not constrained'
        }`
      );
      return;
    }
    console.log(JSON.stringify(payload, null, 2));
  } catch {
    console.log(run.stdout.trim());
  }
}

function printSpanSummary(label, report) {
  const names = [
    'incident.app.sandbox.prepare',
    'incident.app.sandbox.start',
    'incident.app.sandbox.terminal_proxy',
  ];
  console.log(`${label} (${report.generatedAt}):`);
  for (const name of names) {
    const span = report.spans?.byName?.find((item) => item.name === name);
    if (!span) {
      console.log(`  - ${name}: n/a`);
      continue;
    }
    console.log(
      `  - ${name}: count ${span.count}, avg ${span.avgMs}ms, p95 ${span.p95Ms}ms`
    );
  }
}

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
