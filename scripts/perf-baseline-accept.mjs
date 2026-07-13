import {mkdir, readFile, writeFile} from 'node:fs/promises';

const args = process.argv.slice(2);
const reportPath = readOption(args, '--report') ?? 'perf-reports/report.json';
const baselinePath = 'perf-baselines/main.json';

const report = await readFile(reportPath, 'utf8');
JSON.parse(report); // fail fast if the report is not valid JSON

await mkdir('perf-baselines', {recursive: true});
await writeFile(baselinePath, report);

console.log(`accepted ${reportPath} as ${baselinePath}`);

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
