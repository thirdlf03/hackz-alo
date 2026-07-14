import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {promisify} from 'node:util';
import {scoreAiAssistResponse, summarizeAiAssistRuns} from './ai-assist-eval.mjs';

const execFileAsync = promisify(execFile);

const NO_GROUNDED_COMMAND_TEXT = '(画面内に該当するコマンドが見つかりませんでした)';
const UNVERIFIED_NEXT_STEP_TEXT =
  '(画面内の手順から確認できませんでした。Runbook・ターミナルの手がかりを再確認してください)';

/**
 * Scores what the user would actually see once the grounding validator acts
 * on a response: the raw model score for 'ok'/'no_next_step' (nothing
 * changed), the repaired next step for 'repaired', or a deliberately
 * degraded placeholder for 'rejected' (a fabricated command) and
 * 'unverified' (a next step with no verifiable ASCII command that also
 * isn't a substantial copy of a non-CHAT screen line).
 */
function scoreAfterGrounding(testCase, response, grounding) {
  if (grounding.status === 'repaired') {
    return scoreAiAssistResponse(testCase, replaceNextStepSection(response, grounding.repairedNextStep));
  }
  if (grounding.status === 'rejected') {
    return scoreAiAssistResponse(testCase, replaceNextStepSection(response, NO_GROUNDED_COMMAND_TEXT));
  }
  if (grounding.status === 'unverified') {
    return scoreAiAssistResponse(testCase, replaceNextStepSection(response, UNVERIFIED_NEXT_STEP_TEXT));
  }
  return scoreAiAssistResponse(testCase, response);
}

/** Replaces the raw (non-normalized) "次の一手" section of a response, mirroring extractNextStepText(). */
function replaceNextStepSection(response, replacementNextStep) {
  const marker = '次の一手';
  const start = response.indexOf(marker);
  if (start < 0) return response;
  const evidenceIndex = response.indexOf('根拠', start + marker.length);
  const end = evidenceIndex >= 0 ? evidenceIndex : response.length;
  return `${response.slice(0, start)}次の一手: ${replacementNextStep}\n${response.slice(end)}`;
}

export async function runInCurrentChrome({
  cases,
  fixture,
  options,
  sessionOptions,
  inputTemplates,
  stateTextPrompts,
  stateTextSystemPrompt,
  groundAssistNextStep,
}) {
  const config = {
    cases,
    inputTemplates,
    sessionOptions,
    repeat: options.repeat,
    warmup: options.warmup,
    timeoutMs: options.timeoutMs,
    appendImage: options.appendImage,
    stateText: options.stateText,
    stateTextPrompts,
    stateTextSystemPrompt,
    monochrome: options.monochrome,
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
      if (testCase.canvas && groundAssistNextStep) {
        run.grounding = groundAssistNextStep(run.response, testCase.canvas.lines);
        run.qualityAfterGrounding = scoreAfterGrounding(testCase, run.response, run.grounding);
      }
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
      stateText: options.stateText,
      grounding: options.grounding,
      stateFormat: options.stateFormat,
      monochrome: options.monochrome,
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
<style>
  body{font:14px/1.5 system-ui;background:#07111f;color:#e2e8f0;padding:24px 32px 64px;min-height:100vh}
  h1{font-size:20px;margin:0 0 12px}
  h2{font-size:12px;color:#7dd3fc;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em}
  pre{white-space:pre-wrap;word-break:break-word;background:#0f1b2e;border:1px solid #1e293b;border-radius:6px;padding:12px;margin:0}
  #status{color:#7dd3fc}
  #live-output{min-height:4em}
  #run-log{min-height:2em}
</style>
<h1>AI Assist benchmark</h1>
<pre id="status">starting…</pre>
<h2>live output</h2>
<pre id="live-output"></pre>
<h2>completed runs</h2>
<pre id="run-log"></pre>
<script>const CONFIG=${serialized};${fail.toString()};${throttledTextUpdater.toString()};(${browserMain.toString()})().catch(fail);</script></html>`;
}

async function browserMain() {
  const status = document.querySelector('#status');
  const update = (text) => {
    status.textContent = text;
  };
  const liveOutput = throttledTextUpdater(document.querySelector('#live-output'), 100);
  const runLog = document.querySelector('#run-log');
  const appendRunLog = (label, result) => {
    const entry = result.error
      ? `[${label}] ERROR ${result.error.message}`
      : `[${label}] totalMs=${result.metrics?.totalMs}\n${result.response}`;
    runLog.textContent = runLog.textContent ? `${runLog.textContent}\n\n${entry}` : entry;
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
  const hasNonCanvasCase = CONFIG.cases.some((item) => !item.canvas);
  let normalBaseSession;
  let stateTextBaseSession;
  const prewarmStartedAt = performance.now();
  if (CONFIG.stateText) {
    // Base session dedicated to canvas cases in --state-text mode: the
    // image-worded rules in the normal system prompt do not reliably fire
    // for a text-only input, so this uses CONFIG.stateTextSystemPrompt
    // instead (see STATE_TEXT_SYSTEM_PROMPT in ai-assist-state-text.mjs).
    stateTextBaseSession = await LanguageModel.create({
      ...CONFIG.sessionOptions,
      initialPrompts: [{role: 'system', content: CONFIG.stateTextSystemPrompt}],
    });
  } else {
    normalBaseSession = await LanguageModel.create(CONFIG.sessionOptions);
  }
  const prewarm = {
    sessionCreateMs: roundBrowser(performance.now() - prewarmStartedAt),
  };
  if (CONFIG.stateText && hasNonCanvasCase) {
    // Non-canvas cases (e.g. text-only-triage) keep running against the
    // normal ASSIST_SYSTEM_PROMPT even in --state-text mode. Only create
    // this second base session when the fixture actually has such a case.
    normalBaseSession = await LanguageModel.create(CONFIG.sessionOptions);
  }
  function baseSessionFor(item) {
    return item.canvas && CONFIG.stateText ? stateTextBaseSession : normalBaseSession;
  }
  for (const item of CONFIG.cases) {
    for (let index = 0; index < CONFIG.warmup; index += 1) {
      update(`warmup: ${item.id} ${index + 1}/${CONFIG.warmup}`);
      const result = await runCase(item);
      appendRunLog(`${item.id} #warmup${index + 1}`, result);
    }
  }
  const runs = [];
  for (const item of CONFIG.cases) {
    for (let index = 0; index < CONFIG.repeat; index += 1) {
      update(`running: ${item.id} ${index + 1}/${CONFIG.repeat}`);
      const result = await runCase(item);
      appendRunLog(`${item.id} #${index + 1}`, result);
      runs.push({
        caseId: item.id,
        iteration: index + 1,
        ...result,
      });
    }
  }
  const environment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
  };
  stateTextBaseSession?.destroy();
  normalBaseSession?.destroy();
  await post({availability, prewarm, environment, runs});
  update(`完了しました。${runs.length} runs\nこのタブは閉じて構いません。`);

  async function runCase(item) {
    let session;
    const startedAt = performance.now();
    liveOutput.reset();
    try {
      session = await baseSessionFor(item).clone();
      const sessionCreatedAt = performance.now();
      let appendMs;
      let input;
      if (item.canvas && CONFIG.stateText) {
        input = [
          {
            role: 'user',
            content: [{type: 'text', value: CONFIG.stateTextPrompts[item.id]}],
          },
        ];
      } else if (item.canvas && CONFIG.appendImage) {
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
          liveOutput.update(response);
        }
        liveOutput.flush();
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
      context.fillStyle =
        !CONFIG.monochrome && /CRITICAL|DOWN|stopped|ALERT/.test(line) ? '#fb7185' : '#e2e8f0';
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

/**
 * Throttled textContent updater for the live-streaming output <pre>: at most
 * one DOM write per intervalMs, always showing the latest text, plus an
 * explicit flush() so the final chunk is never left stuck behind the
 * throttle window. Never uses innerHTML. Time-based (setTimeout) rather than
 * requestAnimationFrame so it keeps updating even if the tab loses focus,
 * and so it stays off the hot streaming-loop's measured code path (chunk
 * concatenation and the timing performance.now() calls are unaffected;
 * only the (at most 10/s) DOM write is throttled).
 */
function throttledTextUpdater(element, intervalMs) {
  let lastFlushAt = 0;
  let pendingText = '';
  let timerId;
  function flushNow() {
    element.textContent = pendingText;
    lastFlushAt = performance.now();
    timerId = undefined;
  }
  return {
    update(text) {
      pendingText = text;
      const elapsed = performance.now() - lastFlushAt;
      if (elapsed >= intervalMs) {
        flushNow();
      } else if (timerId === undefined) {
        timerId = setTimeout(flushNow, intervalMs - elapsed);
      }
    },
    flush: flushNow,
    reset() {
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
      pendingText = '';
      flushNow();
    },
  };
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
