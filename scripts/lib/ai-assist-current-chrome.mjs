import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {promisify} from 'node:util';
import {scoreAiAssistResponse, summarizeAiAssistRuns} from './ai-assist-eval.mjs';

const execFileAsync = promisify(execFile);

export async function runInCurrentChrome({
  cases,
  fixture,
  options,
  sessionOptions,
  inputTemplates,
}) {
  const config = {
    cases,
    inputTemplates,
    sessionOptions,
    repeat: options.repeat,
    warmup: options.warmup,
    timeoutMs: options.timeoutMs,
    appendImage: options.appendImage,
  };
  const receiver = await startReceiver(config);
  console.log(`opening benchmark in current Chrome: ${receiver.url}`);
  await execFileAsync('open', ['-a', 'Google Chrome', receiver.url]);
  let payload;
  try {
    payload = await receiver.result;
  } finally {
    await receiver.close();
  }
  if (payload.error) {
    throw new Error(
      `${payload.error.name}: ${payload.error.message}; availability=${JSON.stringify(payload.availability)}`
    );
  }

  const runs = payload.runs.map((item) => {
    const run = {
      caseId: item.caseId,
      iteration: item.iteration,
      response: item.response ?? '',
      metrics: item.metrics ?? {},
      ...(item.error ? {error: item.error} : {}),
    };
    if (!run.error) {
      const testCase = cases.find((candidate) => candidate.id === run.caseId);
      run.quality = scoreAiAssistResponse(testCase, run.response);
    }
    return run;
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: {path: options.casesPath, version: fixture.version},
    config: {
      repeat: options.repeat,
      warmup: options.warmup,
      timeoutMs: options.timeoutMs,
      browserMode: 'current-chrome-new-tab',
      sessionPolicy: 'prewarmed-base-clone-per-run',
      throughputUnit: 'Unicode characters per second after first chunk',
      appendImage: options.appendImage,
    },
    environment: payload.environment,
    availability: payload.availability,
    prewarm: payload.prewarm,
    summary: summarizeAiAssistRuns(runs),
    runs,
  };
  await mkdir(dirname(resolve(options.outputPath)), {recursive: true});
  await writeFile(resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, options.outputPath);
  if (report.summary.errorCount > 0) process.exitCode = 1;
}

async function startReceiver(config) {
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });
  const timeoutId = setTimeout(
    () => rejectResult(new Error('current Chrome benchmark timed out')),
    Math.max(120_000, config.timeoutMs * (config.cases.length * (config.repeat + config.warmup) + 1))
  );
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/result') {
      readJsonBody(request)
        .then((body) => {
          clearTimeout(timeoutId);
          resolveResult(body);
          response.writeHead(204).end();
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          rejectResult(error);
          response.writeHead(400).end('invalid result');
        });
      return;
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(renderPage(config));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return {
    url: `http://localhost:${address.port}/`,
    result,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose()))
      ),
  };
}

function renderPage(config) {
  const serialized = JSON.stringify(config).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>AI Assist benchmark</title>
<style>body{font:16px system-ui;background:#07111f;color:#e2e8f0;padding:32px}pre{white-space:pre-wrap}</style>
<h1>AI Assist benchmark</h1><pre id="status">starting…</pre>
<script>const CONFIG=${serialized};${fail.toString()};(${browserMain.toString()})().catch(fail);</script></html>`;
}

async function browserMain() {
  const status = document.querySelector('#status');
  const update = (text) => {
    status.textContent = text;
  };
  if (!globalThis.LanguageModel) throw new Error('LanguageModel is not exposed');
  const availabilityStartedAt = performance.now();
  const state = await LanguageModel.availability({
    expectedInputs: CONFIG.sessionOptions.expectedInputs,
    expectedOutputs: CONFIG.sessionOptions.expectedOutputs,
  });
  const availability = {
    state,
    elapsedMs: roundBrowser(performance.now() - availabilityStartedAt),
  };
  if (state !== 'available') {
    await post({
      error: {name: 'AvailabilityError', message: `LanguageModel is ${state}`},
      availability,
    });
    update(`LanguageModel: ${state}`);
    return;
  }
  const prewarmStartedAt = performance.now();
  const baseSession = await LanguageModel.create(CONFIG.sessionOptions);
  const prewarm = {
    sessionCreateMs: roundBrowser(performance.now() - prewarmStartedAt),
  };
  for (const item of CONFIG.cases) {
    for (let index = 0; index < CONFIG.warmup; index += 1) {
      update(`warmup: ${item.id} ${index + 1}/${CONFIG.warmup}`);
      await runCase(item);
    }
  }
  const runs = [];
  for (const item of CONFIG.cases) {
    for (let index = 0; index < CONFIG.repeat; index += 1) {
      update(`running: ${item.id} ${index + 1}/${CONFIG.repeat}`);
      runs.push({
        caseId: item.id,
        iteration: index + 1,
        ...(await runCase(item)),
      });
    }
  }
  const environment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
  };
  baseSession.destroy();
  await post({availability, prewarm, environment, runs});
  update(`完了しました。${runs.length} runs\nこのタブは閉じて構いません。`);

  async function runCase(item) {
    let session;
    const startedAt = performance.now();
    try {
      session = await baseSession.clone();
      const sessionCreatedAt = performance.now();
      let appendMs;
      let input;
      if (item.canvas && CONFIG.appendImage) {
        const canvas = renderCanvas(item.canvas);
        const appendStartedAt = performance.now();
        await session.append([{role: 'user', content: [{type: 'image', value: canvas}]}]);
        appendMs = roundBrowser(performance.now() - appendStartedAt);
        const template = structuredClone(CONFIG.inputTemplates[item.id]);
        input = template.map((message) => ({
          ...message,
          content: message.content.filter((part) => part.type !== 'image'),
        }));
      } else {
        input = structuredClone(CONFIG.inputTemplates[item.id]);
        if (item.canvas) {
          const imagePart = input[0].content.find((part) => part.type === 'image');
          imagePart.value = renderCanvas(item.canvas);
        }
      }
      const inputPreparedAt = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('benchmark timeout'), CONFIG.timeoutMs);
      let firstChunkAt;
      let firstChunkCharacters = 0;
      let response = '';
      let chunks = 0;
      try {
        const promptStartedAt = performance.now();
        const stream = session.promptStreaming(input, {signal: controller.signal});
        for await (const chunk of stream) {
          if (firstChunkAt === undefined && chunk.length > 0) {
            firstChunkAt = performance.now();
            firstChunkCharacters = [...chunk].length;
          }
          response += chunk;
          chunks += 1;
        }
        const completedAt = performance.now();
        const generationMs = Math.max(0, completedAt - (firstChunkAt ?? completedAt));
        const outputCharacters = [...response].length;
        const remainingCharacters = outputCharacters - firstChunkCharacters;
        return {
          response,
          metrics: {
            sessionCreateMs: roundBrowser(sessionCreatedAt - startedAt),
            sessionCloneMs: roundBrowser(sessionCreatedAt - startedAt),
            ...(appendMs !== undefined ? {appendMs} : {}),
            inputPrepareMs: roundBrowser(inputPreparedAt - sessionCreatedAt),
            ttftMs: roundBrowser((firstChunkAt ?? completedAt) - promptStartedAt),
            totalMs: roundBrowser(completedAt - promptStartedAt),
            endToEndMs: roundBrowser(completedAt - startedAt),
            generationMs: roundBrowser(generationMs),
            outputCharacters,
            chunks,
            charsPerSecond:
              generationMs > 0 && remainingCharacters > 0
                ? roundBrowser((remainingCharacters / generationMs) * 1000)
                : undefined,
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {error: {name: error?.name ?? 'Error', message: error?.message ?? String(error)}};
    } finally {
      session?.destroy();
    }
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

  async function post(value) {
    await fetch('/result', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(value),
    });
  }

  function roundBrowser(value) {
    return Math.round(value * 1000) / 1000;
  }
}

async function fail(error) {
  document.querySelector('#status').textContent = `${error.name}: ${error.message}`;
  await fetch('/result', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({error: {name: error.name, message: error.message}}),
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('benchmark result is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function printSummary(report, outputPath) {
  const summary = report.summary;
  console.log(`quality: ${(summary.meanQualityScore * 100).toFixed(1)}%`);
  console.log(`pass rate: ${(summary.allRunPassRate * 100).toFixed(1)}%`);
  console.log(`TTFT: median=${summary.ttftMs.median}ms p95=${summary.ttftMs.p95}ms`);
  console.log(`total: median=${summary.totalMs.median}ms p95=${summary.totalMs.p95}ms`);
  console.log(`throughput: median=${summary.charsPerSecond.median ?? '-'} chars/s`);
  console.log(`report: ${outputPath}`);
}
