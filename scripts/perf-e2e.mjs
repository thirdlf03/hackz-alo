import {spawn} from 'node:child_process';
import {mkdir, readFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';

const {writeTraceJsonl} = await tsImport(
  '../packages/observability/src/node/index.ts',
  import.meta.url
);

const traceRecords = [];
const env = {
  ...process.env,
  INCIDENT_PERF: '1',
  INCIDENT_DISABLE_TURNSTILE: '1',
  VITE_TURNSTILE_SITE_KEY: '',
  VITE_INCIDENT_PERF: '1',
};

await mkdir('.perf', {recursive: true});
await mkdir('perf-reports', {recursive: true});
await writeTraceJsonl('.perf/traces.jsonl', []);

const dev = spawn('pnpm', ['run', 'dev'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
pipeAndCollect(dev.stdout);
pipeAndCollect(dev.stderr);

let exitCode = 0;
try {
  await waitForReady('http://127.0.0.1:5173/api/scenarios', 180_000);
  exitCode = await runPlaywright();
} finally {
  dev.kill('SIGTERM');
  await appendBrowserSnapshot();
  await writeTraceJsonl('.perf/traces.jsonl', traceRecords);
}

process.exitCode = exitCode;

function pipeAndCollect(stream) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    process.stdout.write(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) collectTraceLine(line);
  });
}

function collectTraceLine(line) {
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) return;
  try {
    const parsed = JSON.parse(line.slice(jsonStart));
    if (
      parsed.event === 'incident_perf_span' ||
      parsed.event === 'incident_perf_mark'
    ) {
      const {event: _event, ...record} = parsed;
      traceRecords.push(record);
    }
  } catch {
    // Ignore non-JSON dev server output.
  }
}

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling while the dev server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`perf dev server did not become ready: ${url}`);
}

async function runPlaywright() {
  const child = spawn(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=playwright.perf.config.ts'],
    {env, stdio: 'inherit'}
  );
  return await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function appendBrowserSnapshot() {
  try {
    const snapshot = JSON.parse(
      await readFile('perf-reports/browser-snapshot.json', 'utf8')
    );
    traceRecords.push(
      ...(snapshot.spans ?? []),
      ...(snapshot.marks ?? []),
      ...(snapshot.frameSamples ?? [])
    );
  } catch {
    // Snapshot is absent when Playwright fails before the page is ready.
  }
}
