import {mkdir, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {tsImport} from 'tsx/esm/api';

const {getScenario} = await tsImport(
  '../packages/scenarios/src/index.ts',
  import.meta.url
);
const {createEmptyTerminalMirror} = await tsImport(
  '../apps/web/src/game/terminal/mirror.ts',
  import.meta.url
);
const {advanceGameState, createInitialGameState, visibleRunbooks} =
  await tsImport('../apps/web/src/game/state/gameState.ts', import.meta.url);
const {buildMetricSections} = await tsImport(
  '../apps/web/src/pure/metricsSections.ts',
  import.meta.url
);
const {buildCanvasViewModel} = await tsImport(
  '../apps/web/src/pure/canvasViewModel.ts',
  import.meta.url
);

const scenario = getScenario('process-stop-001') ?? getScenario('demo-tutorial-001');
if (!scenario) throw new Error('benchmark scenario not found');

const initialState = createInitialGameState(
  scenario,
  'sess_perf',
  'repl_perf',
  createEmptyTerminalMirror()
);
const sampleMetrics = {
  at: Date.now(),
  cpu: 78,
  memory: 64,
  disk: 72,
  http5xxRate: 0.04,
  latencyP95Ms: 920,
  rps: 42,
  dbConnections: 18,
  queueDepth: 7,
};

const benchmarks = {
  advanceGameState: runBench('advanceGameState', 3000, () => {
    advanceGameState(
      initialState,
      45_000,
      scenario,
      1,
      500,
      initialState.monitors.left.alerts,
      initialState.monitors.right.slackMessages
    );
  }),
  buildMetricSections: runBench('buildMetricSections', 5000, () => {
    buildMetricSections(sampleMetrics);
  }),
  buildCanvasViewModel: runBench('buildCanvasViewModel', 5000, () => {
    buildCanvasViewModel(initialState, scenario);
  }),
  visibleRunbooks: runBench('visibleRunbooks', 5000, () => {
    visibleRunbooks(scenario, 45_000);
  }),
};

await mkdir('.perf', {recursive: true});
await writeFile(
  '.perf/bench.json',
  JSON.stringify({generatedAt: new Date().toISOString(), benchmarks}, null, 2)
);

for (const [name, result] of Object.entries(benchmarks)) {
  console.log(
    `${name}: mean=${result.meanMs.toFixed(4)}ms p95=${result.p95Ms.toFixed(4)}ms`
  );
}

function runBench(name, iterations, fn) {
  for (let index = 0; index < 100; index += 1) fn();
  const durations = [];
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const itemStartedAt = performance.now();
    fn();
    durations.push(performance.now() - itemStartedAt);
  }
  const totalMs = performance.now() - startedAt;
  durations.sort((left, right) => left - right);
  const p95Index = Math.min(
    durations.length - 1,
    Math.max(0, Math.ceil(durations.length * 0.95) - 1)
  );
  return {
    name,
    iterations,
    totalMs: round(totalMs),
    meanMs: round(totalMs / iterations),
    p95Ms: round(durations[p95Index] ?? 0),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
