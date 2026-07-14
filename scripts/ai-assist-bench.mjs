import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {tsImport} from 'tsx/esm/api';
import {
  parseAiAssistArgs,
  scoreAiAssistResponse,
  summarizeAiAssistRuns,
  validateAiAssistCases,
} from './lib/ai-assist-eval.mjs';
import {
  buildPanelStateAskText,
  buildStateAskText,
  STATE_TEXT_SYSTEM_PROMPT,
} from './lib/ai-assist-state-text.mjs';

const HELP = `Gemini Nano / AI Assist benchmark

Usage: pnpm run bench:ai-assist -- [options]

  --cases <path>            Case JSON (default: scripts/fixtures/ai-assist-cases.json)
  --output <path>           JSON report (default: .perf/ai-assist-bench.json)
  --repeat <n>              Measured runs per case (default: 3)
  --warmup <n>              Unreported warmups per case (default: 1)
  --timeout-ms <n>          Prompt timeout (default: 60000)
  --user-data-dir <path>    Persistent Chrome profile for the downloaded model
  --executable-path <path>  Chrome executable instead of Playwright channel=chrome
  --cdp-url <url>           Reuse Chrome started with --remote-debugging-port
  --current-chrome          Run in a new tab of the currently open Chrome
  --append-image            Prewarm image input via session.append() before promptStreaming (requires --current-chrome)
  --state-text              Feed a text screen dump instead of a screenshot image (requires --current-chrome, exclusive with --append-image)
  --state-format <flat|panels>  Layout of the --state-text dump: flat (default) or panels grouped by alert/terminal/runbook/chat/metrics
  --monochrome              Disable canvas red-highlighting in image mode; render all lines in #e2e8f0 (exclusive with --state-text)
  --grounding               Cross-check each canvas case's next-step answer against the screen text and record run.grounding
  --headless                Run headless (Gemini Nano may not be available)
  -h, --help                Show this help
`;

const options = parseAiAssistArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(process.exitCode ?? 0);
}
if (options.appendImage && !options.currentChrome) {
  console.error('--append-image requires --current-chrome');
  process.exit(1);
}
if (options.stateText && !options.currentChrome) {
  console.error('--state-text requires --current-chrome');
  process.exit(1);
}

const fixture = JSON.parse(await readFile(resolve(options.casesPath), 'utf8'));
const cases = validateAiAssistCases(fixture);
const {ASSIST_SYSTEM_PROMPT, buildAssistPrompt} = await tsImport(
  '../apps/web/src/pure/aiAssist.ts',
  import.meta.url
);
const {askAssistant} = await tsImport(
  '../apps/web/src/effect/promptAssistant.ts',
  import.meta.url
);
const {groundAssistNextStep} = options.grounding
  ? await tsImport('../apps/web/src/pure/assistGrounding.ts', import.meta.url)
  : {groundAssistNextStep: undefined};
const buildStateTextPrompt =
  options.stateFormat === 'panels' ? buildPanelStateAskText : buildStateAskText;
const stateTextPrompts = Object.fromEntries(
  cases
    .filter((testCase) => testCase.canvas)
    .map((testCase) => [
      testCase.id,
      buildStateTextPrompt(testCase.canvas.lines, testCase.canvas.title, testCase.question),
    ])
);
const expectedInputs = [
  {type: 'text', languages: ['ja', 'en']},
  ...(cases.some((item) => item.canvas)
    ? [{type: 'image', languages: ['ja', 'en']}]
    : []),
];
const sessionOptions = {
  initialPrompts: [{role: 'system', content: ASSIST_SYSTEM_PROMPT}],
  expectedInputs,
  expectedOutputs: [{type: 'text', languages: ['ja']}],
};
const availabilityOptions = {
  expectedInputs: sessionOptions.expectedInputs,
  expectedOutputs: sessionOptions.expectedOutputs,
};

if (options.currentChrome) {
  const {runInCurrentChrome} = await import('./lib/ai-assist-current-chrome.mjs');
  await runInCurrentChrome({
    cases,
    fixture,
    options,
    sessionOptions,
    inputTemplates: Object.fromEntries(
      cases.map((testCase) => [testCase.id, buildProductionInput(testCase)])
    ),
    stateTextPrompts,
    stateTextSystemPrompt: STATE_TEXT_SYSTEM_PROMPT,
    groundAssistNextStep,
  });
  process.exit(0);
}

const server = await startLocalhostServer();
let browser;
let context;
let page;
let ownsContext = false;
try {
  if (options.cdpUrl) {
    browser = await chromium.connectOverCDP(options.cdpUrl);
    context = browser.contexts()[0];
    if (!context) throw new Error('CDP browser has no context');
  } else {
    const userDataDir = resolve(options.userDataDir ?? '.perf/ai-assist-chrome-profile');
    await mkdir(userDataDir, {recursive: true});
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: options.headless,
      ...(options.executablePath
        ? {executablePath: resolve(options.executablePath)}
        : {channel: 'chrome'}),
    });
    ownsContext = true;
  }
  page = await context.newPage();
  await page.goto(server.url);
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    languageModelExposed: typeof globalThis.LanguageModel !== 'undefined',
  }));
  if (!environment.languageModelExposed) {
    throw new Error(
      'LanguageModel is not exposed. Enable Chrome built-in AI flags/origin access and use a supported desktop Chrome.'
    );
  }
  const availabilityStartedAt = performance.now();
  const availability = await page.evaluate(
    (modelOptions) => globalThis.LanguageModel.availability(modelOptions),
    availabilityOptions
  );
  const availabilityMs = performance.now() - availabilityStartedAt;
  if (availability !== 'available') {
    const diagnostics = await page.evaluate(async () => {
      const checks = {
        default: undefined,
        textEnglish: {
          expectedInputs: [{type: 'text', languages: ['en']}],
          expectedOutputs: [{type: 'text', languages: ['en']}],
        },
        textJapaneseEnglish: {
          expectedInputs: [{type: 'text', languages: ['ja', 'en']}],
          expectedOutputs: [{type: 'text', languages: ['ja']}],
        },
        imageJapaneseEnglish: {
          expectedInputs: [
            {type: 'text', languages: ['ja', 'en']},
            {type: 'image', languages: ['ja', 'en']},
          ],
          expectedOutputs: [{type: 'text', languages: ['ja']}],
        },
      };
      return Object.fromEntries(
        await Promise.all(
          Object.entries(checks).map(async ([name, options]) => [
            name,
            await globalThis.LanguageModel.availability(options),
          ])
        )
      );
    });
    throw new Error(
      `LanguageModel availability is ${availability}; diagnostics=${JSON.stringify(diagnostics)}`
    );
  }

  for (const item of cases) {
    for (let index = 0; index < options.warmup; index += 1) {
      console.log(`warmup ${item.id} ${index + 1}/${options.warmup}`);
      await runInBrowser(
        page,
        item,
        buildProductionInput(item),
        sessionOptions,
        options.timeoutMs
      );
    }
  }

  const runs = [];
  for (const item of cases) {
    for (let index = 0; index < options.repeat; index += 1) {
      process.stdout.write(`run ${item.id} ${index + 1}/${options.repeat} ... `);
      const result = await runInBrowser(
        page,
        item,
        buildProductionInput(item),
        sessionOptions,
        options.timeoutMs
      );
      const run = {
        caseId: item.id,
        iteration: index + 1,
        response: result.response ?? '',
        metrics: result.metrics ?? {},
        ...(result.error ? {error: result.error} : {}),
      };
      if (!run.error) run.quality = scoreAiAssistResponse(item, run.response);
      if (!run.error && item.canvas && groundAssistNextStep) {
        run.grounding = groundAssistNextStep(run.response, item.canvas.lines);
      }
      runs.push(run);
      console.log(
        run.error
          ? `ERROR ${run.error.message}`
          : `${run.metrics.totalMs.toFixed(0)}ms, TTFT ${run.metrics.ttftMs.toFixed(0)}ms, quality ${(run.quality.score * 100).toFixed(0)}%`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: {path: options.casesPath, version: fixture.version},
    config: {
      repeat: options.repeat,
      warmup: options.warmup,
      timeoutMs: options.timeoutMs,
      sessionPolicy: 'new-session-per-run',
      throughputUnit: 'Unicode characters per second after first chunk',
      grounding: options.grounding,
      stateFormat: options.stateFormat,
      monochrome: options.monochrome,
    },
    environment,
    availability: {state: availability, elapsedMs: round(availabilityMs)},
    summary: summarizeAiAssistRuns(runs),
    runs,
  };
  await mkdir(dirname(resolve(options.outputPath)), {recursive: true});
  await writeFile(resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, options.outputPath);
  if (report.summary.errorCount > 0) process.exitCode = 1;
} finally {
  if (ownsContext) await context?.close();
  else await page?.close();
  await server.close();
}

function buildProductionInput(testCase) {
  let input;
  const rawQuestion = testCase.stateBlock
    ? `${testCase.stateBlock}\n${testCase.question}`
    : testCase.question;
  const question = buildAssistPrompt(rawQuestion);
  if (!question) throw new Error(`${testCase.id}: question became empty after normalization`);
  askAssistant(
    {
      promptStreaming(value) {
        input = value;
        return undefined;
      },
      destroy() {},
    },
    question,
    testCase.canvas ? {} : undefined
  );
  return input;
}

async function runInBrowser(page, testCase, inputTemplate, createOptions, timeoutMs) {
  return page.evaluate(
    async ({testCase: item, inputTemplate: productionInput, createOptions: modelOptions, timeoutMs: timeout}) => {
      let session;
      const startedAt = performance.now();
      try {
        session = await globalThis.LanguageModel.create(modelOptions);
        const sessionCreatedAt = performance.now();
        const input = structuredClone(productionInput);
        if (item.canvas) {
          const imagePart = input[0].content.find((part) => part.type === 'image');
          if (!imagePart) throw new Error('production input did not contain an image part');
          imagePart.value = renderCanvas(item.canvas);
        }
        const inputPreparedAt = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('benchmark timeout'), timeout);
        let firstChunkAt;
        let firstChunkCharacters = 0;
        let response = '';
        let chunks = 0;
        try {
          const promptStartedAt = performance.now();
          const stream = session.promptStreaming(input, {
            signal: controller.signal,
          });
          for await (const chunk of stream) {
            if (firstChunkAt === undefined && chunk.length > 0) {
              firstChunkAt = performance.now();
              firstChunkCharacters = [...chunk].length;
            }
            response += chunk;
            chunks += 1;
          }
          const completedAt = performance.now();
          const ttftMs = (firstChunkAt ?? completedAt) - promptStartedAt;
          const generationMs = Math.max(0, completedAt - (firstChunkAt ?? completedAt));
          const outputCharacters = [...response].length;
          const postFirstChunkCharacters = outputCharacters - firstChunkCharacters;
          return {
            response,
            metrics: {
              sessionCreateMs: roundBrowser(sessionCreatedAt - startedAt),
              inputPrepareMs: roundBrowser(inputPreparedAt - sessionCreatedAt),
              ttftMs: roundBrowser(ttftMs),
              totalMs: roundBrowser(completedAt - promptStartedAt),
              endToEndMs: roundBrowser(completedAt - startedAt),
              generationMs: roundBrowser(generationMs),
              outputCharacters,
              chunks,
              charsPerSecond:
                generationMs > 0 && postFirstChunkCharacters > 0
                  ? roundBrowser((postFirstChunkCharacters / generationMs) * 1000)
                  : undefined,
            },
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        return {
          error: {name: error?.name ?? 'Error', message: error?.message ?? String(error)},
        };
      } finally {
        session?.destroy();
      }

      function renderCanvas(spec) {
        const canvas = document.createElement('canvas');
        canvas.width = spec.width;
        canvas.height = spec.height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#07111f';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / 1280, canvas.height / 720);
        context.scale(scale, scale);
        context.fillStyle = '#7dd3fc';
        context.font = 'bold 30px sans-serif';
        context.fillText(spec.title ?? 'INCIDENT TRAINING', 48, 60);
        context.font = '25px monospace';
        spec.lines.forEach((line, index) => {
          context.fillStyle = /CRITICAL|DOWN|stopped|ALERT/.test(line) ? '#fb7185' : '#e2e8f0';
          context.fillText(line, 48, 125 + index * 68);
        });
        return canvas;
      }

      function roundBrowser(value) {
        return Math.round(value * 1000) / 1000;
      }
    },
    {testCase, inputTemplate, createOptions, timeoutMs}
  );
}

async function startLocalhostServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><html lang="ja"><title>AI Assist benchmark</title><body>benchmark</body></html>');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return {
    url: `http://localhost:${address.port}/`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose()))),
  };
}

function printSummary(report, outputPath) {
  const summary = report.summary;
  console.log(`\nquality: ${(summary.meanQualityScore * 100).toFixed(1)}% (pass rate ${(summary.casePassRate * 100).toFixed(1)}%)`);
  console.log(`TTFT: median=${formatMetric(summary.ttftMs.median)} p95=${formatMetric(summary.ttftMs.p95)}`);
  console.log(`total: median=${formatMetric(summary.totalMs.median)} p95=${formatMetric(summary.totalMs.p95)}`);
  console.log(`throughput: median=${summary.charsPerSecond.median ?? '-'} chars/s`);
  console.log(`report: ${outputPath}`);
}

function formatMetric(value) {
  return value === undefined ? '-' : `${value}ms`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
