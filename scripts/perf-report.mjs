import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';

const {buildPerfReport, readTraceJsonl} = await tsImport(
  '../packages/observability/src/node/index.ts',
  import.meta.url
);

const records = await readTraceJsonl('.perf/traces.jsonl');
const benchmarks = await readJson('.perf/bench.json').then(
  (value) => value?.benchmarks
);
const report = buildPerfReport({records, benchmarks});

await mkdir('perf-reports', {recursive: true});
await writeFile('perf-reports/report.json', JSON.stringify(report, null, 2));
await writeFile('perf-reports/report.md', markdownReport(report));

console.log(
  `perf report: ${report.spans.count} spans, ${report.marks.length} mark groups, ${Object.keys(report.benchmarks ?? {}).length} benchmarks`
);

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function markdownReport(report) {
  const lines = [
    '# Incident Perf Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Spans: ${report.spans.count}`,
    `Frame samples: ${report.frames.count}`,
    `Frame p95: ${report.frames.p95DrawMs}ms`,
    '',
    '## Benchmarks',
    '',
  ];
  for (const [name, result] of Object.entries(report.benchmarks ?? {})) {
    lines.push(
      `- ${name}: mean ${result.meanMs}ms, p95 ${result.p95Ms}ms (${result.iterations} iterations)`
    );
  }
  lines.push('', '## Spans', '');
  for (const span of report.spans.byName) {
    lines.push(
      `- ${span.name}: count ${span.count}, avg ${span.avgMs}ms, p95 ${span.p95Ms}ms`
    );
  }
  return `${lines.join('\n')}\n`;
}
