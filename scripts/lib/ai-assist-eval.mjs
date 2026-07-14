export function parseAiAssistArgs(args) {
  const options = {
    casesPath: 'scripts/fixtures/ai-assist-cases.json',
    outputPath: '.perf/ai-assist-bench.json',
    repeat: 3,
    warmup: 1,
    timeoutMs: 60_000,
    headless: false,
    help: false,
    appendImage: false,
    stateText: false,
    grounding: false,
    stateFormat: 'flat',
    monochrome: false,
  };
  let stateFormatSpecified = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--headless') options.headless = true;
    else if (argument === '--current-chrome') options.currentChrome = true;
    else if (argument === '--append-image') options.appendImage = true;
    else if (argument === '--state-text') options.stateText = true;
    else if (argument === '--grounding') options.grounding = true;
    else if (argument === '--monochrome') options.monochrome = true;
    else if (argument === '--state-format') {
      options.stateFormat = requiredValue(args, ++index, argument);
      stateFormatSpecified = true;
    } else if (argument === '--cases') options.casesPath = requiredValue(args, ++index, argument);
    else if (argument === '--output') options.outputPath = requiredValue(args, ++index, argument);
    else if (argument === '--repeat') options.repeat = positiveInteger(args, ++index, argument);
    else if (argument === '--warmup') options.warmup = nonNegativeInteger(args, ++index, argument);
    else if (argument === '--timeout-ms') options.timeoutMs = positiveInteger(args, ++index, argument);
    else if (argument === '--executable-path')
      options.executablePath = requiredValue(args, ++index, argument);
    else if (argument === '--user-data-dir')
      options.userDataDir = requiredValue(args, ++index, argument);
    else if (argument === '--cdp-url')
      options.cdpUrl = requiredValue(args, ++index, argument);
    else throw new Error(`unknown option: ${argument}`);
  }
  if (options.appendImage && options.stateText) {
    throw new Error('--append-image and --state-text cannot be combined');
  }
  if (options.stateFormat !== 'flat' && options.stateFormat !== 'panels') {
    throw new Error('--state-format must be flat or panels');
  }
  if (stateFormatSpecified && !options.stateText) {
    throw new Error('--state-format requires --state-text');
  }
  if (options.monochrome && options.stateText) {
    throw new Error('--monochrome and --state-text cannot be combined');
  }
  return options;
}

export function validateAiAssistCases(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.cases)) {
    throw new Error('case file must contain a cases array');
  }
  if (value.cases.length === 0) throw new Error('case file must not be empty');
  const ids = new Set();
  for (const item of value.cases) {
    if (!item || typeof item !== 'object') throw new Error('each case must be an object');
    if (typeof item.id !== 'string' || item.id.trim() === '')
      throw new Error('each case must have an id');
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.question !== 'string' || item.question.trim() === '')
      throw new Error(`${item.id}: question must be a non-empty string`);
    if (item.canvas !== undefined) validateCanvas(item.id, item.canvas);
    validateStringArray(item.id, 'requiredAll', item.rubric?.requiredAll ?? []);
    validateStringArray(item.id, 'forbidden', item.rubric?.forbidden ?? []);
    validateStringArray(item.id, 'nextStepForbidden', item.rubric?.nextStepForbidden ?? []);
    if (!Array.isArray(item.rubric?.requiredAny ?? []))
      throw new Error(`${item.id}: requiredAny must be an array`);
    for (const group of item.rubric?.requiredAny ?? []) {
      validateStringArray(item.id, 'requiredAny group', group);
      if (group.length === 0) throw new Error(`${item.id}: requiredAny group must not be empty`);
    }
    if (!Array.isArray(item.rubric?.nextStepRequiredAny ?? []))
      throw new Error(`${item.id}: nextStepRequiredAny must be an array`);
    for (const group of item.rubric?.nextStepRequiredAny ?? []) {
      validateStringArray(item.id, 'nextStepRequiredAny group', group);
      if (group.length === 0) throw new Error(`${item.id}: nextStepRequiredAny group must not be empty`);
    }
  }
  return value.cases;
}

export function scoreAiAssistResponse(testCase, response) {
  const normalized = normalize(response);
  const rubric = testCase.rubric ?? {};
  const checks = [];
  for (const expected of rubric.requiredAll ?? []) {
    checks.push({kind: 'requiredAll', expected, passed: hasAffirmedTerm(normalized, expected)});
  }
  for (const alternatives of rubric.requiredAny ?? []) {
    checks.push({
      kind: 'requiredAny',
      expected: alternatives,
      passed: alternatives.some((term) => hasAffirmedTerm(normalized, term)),
    });
  }
  for (const forbidden of rubric.forbidden ?? []) {
    checks.push({kind: 'forbidden', expected: forbidden, passed: !hasAffirmedTerm(normalized, forbidden)});
  }
  const nextStepSection = extractNextStepSection(normalized);
  for (const alternatives of rubric.nextStepRequiredAny ?? []) {
    checks.push({
      kind: 'nextStepRequiredAny',
      expected: alternatives,
      passed: alternatives.some((term) => hasAffirmedTerm(nextStepSection, term)),
    });
  }
  for (const forbidden of rubric.nextStepForbidden ?? []) {
    checks.push({
      kind: 'nextStepForbidden',
      expected: forbidden,
      passed: !hasAffirmedTerm(nextStepSection, forbidden),
    });
  }
  const nonEmpty = response.trim().length > 0;
  checks.push({kind: 'nonEmpty', passed: nonEmpty});
  const passedCount = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 1 : passedCount / checks.length;
  const threshold = rubric.passThreshold ?? 0.75;
  const forbiddenPassed = checks
    .filter((check) => check.kind === 'forbidden' || check.kind === 'nextStepForbidden')
    .every((check) => check.passed);
  return {
    score: round(score),
    passed: nonEmpty && forbiddenPassed && score >= threshold,
    passedCount,
    checkCount: checks.length,
    checks,
  };
}

export function summarizeAiAssistRuns(runs) {
  const successful = runs.filter((run) => !run.error);
  const quality = successful.map((run) => run.quality.score);
  const passedRuns = successful.filter((run) => run.quality.passed).length;
  const cases = new Map();
  for (const run of runs) {
    const caseId = run.caseId ?? 'unknown';
    cases.set(caseId, [...(cases.get(caseId) ?? []), run]);
  }
  const byCase = [...cases.entries()].map(([caseId, caseRuns]) => {
    const scored = caseRuns.filter((run) => !run.error);
    const passCount = scored.filter((run) => run.quality.passed).length;
    const item = {
      caseId,
      runCount: caseRuns.length,
      errorCount: caseRuns.length - scored.length,
      passRate: ratio(passCount, caseRuns.length),
      meanQualityScore: mean(scored.map((run) => run.quality.score)),
    };
    for (const field of [
      'sessionCreateMs',
      'sessionCloneMs',
      'appendMs',
      'inputPrepareMs',
      'ttftMs',
      'totalMs',
      'endToEndMs',
      'charsPerSecond',
    ]) {
      item[field] = summarizeNumbers(
        scored.map((run) => run.metrics[field]).filter(Number.isFinite)
      );
    }
    const groundingCounts = countGroundingStatuses(caseRuns);
    if (groundingCounts) item.grounding = groundingCounts;
    const afterGroundingPassRate = passRateAfterGrounding(scored, caseRuns);
    if (afterGroundingPassRate !== undefined) item.passRateAfterGrounding = afterGroundingPassRate;
    return item;
  });
  const summary = {
    runCount: runs.length,
    successCount: successful.length,
    errorCount: runs.length - successful.length,
    successfulRunPassRate: ratio(passedRuns, successful.length),
    allRunPassRate: ratio(passedRuns, runs.length),
    casePassRate: ratio(
      byCase.filter((item) => item.passRate >= 0.5).length,
      byCase.length
    ),
    meanQualityScore: mean(quality),
    byCase,
  };
  for (const field of [
    'sessionCreateMs',
    'sessionCloneMs',
    'appendMs',
    'inputPrepareMs',
    'ttftMs',
    'totalMs',
    'endToEndMs',
    'charsPerSecond',
  ]) {
    const values = successful.map((run) => run.metrics[field]).filter(Number.isFinite);
    summary[field] = summarizeNumbers(values);
  }
  const groundingCounts = countGroundingStatuses(runs);
  if (groundingCounts) summary.grounding = groundingCounts;
  const afterGroundingPassRate = passRateAfterGrounding(successful, runs);
  if (afterGroundingPassRate !== undefined) summary.passRateAfterGrounding = afterGroundingPassRate;
  return summary;
}

/**
 * Pass rate as the user would actually experience it once the grounding
 * validator repairs/degrades responses (see run.qualityAfterGrounding in
 * ai-assist-current-chrome.mjs), alongside the raw model pass rate above.
 * Returns undefined when no run in `scoredRuns` carries a qualityAfterGrounding
 * (i.e. --grounding was not used), so it doesn't clutter reports that never
 * ran the validator.
 */
function passRateAfterGrounding(scoredRuns, denominatorRuns) {
  if (!scoredRuns.some((run) => run.qualityAfterGrounding)) return undefined;
  const passed = scoredRuns.filter(
    (run) => (run.qualityAfterGrounding ?? run.quality).passed
  ).length;
  return ratio(passed, denominatorRuns.length);
}

function countGroundingStatuses(runs) {
  const counts = {ok: 0, repaired: 0, rejected: 0, unverified: 0, no_next_step: 0};
  let total = 0;
  for (const run of runs) {
    if (!run.grounding) continue;
    total += 1;
    counts[run.grounding.status] = (counts[run.grounding.status] ?? 0) + 1;
  }
  return total > 0 ? {total, ...counts} : undefined;
}

export function summarizeNumbers(values) {
  if (values.length === 0) return {count: 0};
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)),
    mean: mean(sorted),
  };
}

function validateCanvas(id, canvas) {
  if (!Number.isFinite(canvas.width) || canvas.width <= 0 || !Number.isFinite(canvas.height) || canvas.height <= 0)
    throw new Error(`${id}: canvas width and height must be positive`);
  if (!Array.isArray(canvas.lines) || canvas.lines.some((line) => typeof line !== 'string'))
    throw new Error(`${id}: canvas lines must be a string array`);
}

function validateStringArray(id, name, value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === ''))
    throw new Error(`${id}: ${name} must be a string array`);
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(args, index, option) {
  const value = Number(requiredValue(args, index, option));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${option} must be a positive integer`);
  return value;
}

function nonNegativeInteger(args, index, option) {
  const value = Number(requiredValue(args, index, option));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${option} must be a non-negative integer`);
  return value;
}

function normalize(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, ' ').trim();
}

function extractNextStepSection(normalizedText) {
  const marker = normalize('次の一手');
  const start = normalizedText.indexOf(marker);
  if (start < 0) return '';
  const evidenceMarker = normalize('根拠');
  const evidenceIndex = normalizedText.indexOf(evidenceMarker, start + marker.length);
  const end = evidenceIndex >= 0 ? evidenceIndex : normalizedText.length;
  return normalizedText.slice(start, end);
}

function hasAffirmedTerm(normalizedText, term) {
  const needle = normalize(term);
  let offset = normalizedText.indexOf(needle);
  while (offset >= 0) {
    const before = normalizedText.slice(Math.max(0, offset - 5), offset);
    const after = normalizedText.slice(offset + needle.length, offset + needle.length + 40);
    const negatedBefore = /(?:not|no)\s*$/.test(before);
    const negatedAfter = /^(?:(?![。.!！?？]).){0,30}(?:ない|なし|ありません|できない|できません|ではなく|とは限りません)/.test(
      after
    );
    if (!negatedBefore && !negatedAfter) return true;
    offset = normalizedText.indexOf(needle, offset + needle.length);
  }
  return false;
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function mean(values) {
  return values.length === 0 ? undefined : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
