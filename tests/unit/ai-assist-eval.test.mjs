import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  parseAiAssistArgs,
  scoreAiAssistResponse,
  summarizeAiAssistRuns,
  summarizeNumbers,
  validateAiAssistCases,
} from '../../scripts/lib/ai-assist-eval.mjs';

test('AI Assist benchmark arguments have safe repeatable defaults', () => {
  assert.deepEqual(parseAiAssistArgs([]), {
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
  });
  assert.equal(parseAiAssistArgs(['--repeat', '5', '--headless']).repeat, 5);
  assert.equal(parseAiAssistArgs(['--', '--repeat', '5']).repeat, 5);
  assert.equal(parseAiAssistArgs(['--current-chrome']).currentChrome, true);
  assert.equal(parseAiAssistArgs(['--append-image']).appendImage, true);
  assert.equal(parseAiAssistArgs(['--state-text']).stateText, true);
  assert.equal(parseAiAssistArgs(['--grounding']).grounding, true);
  assert.equal(
    parseAiAssistArgs(['--cdp-url', 'http://localhost:9222']).cdpUrl,
    'http://localhost:9222'
  );
  assert.throws(() => parseAiAssistArgs(['--repeat', '0']), /positive integer/);
  assert.throws(() => parseAiAssistArgs(['--wat']), /unknown option/);
  assert.throws(
    () => parseAiAssistArgs(['--append-image', '--state-text']),
    /--append-image and --state-text cannot be combined/
  );
});

test('--state-format is parsed and validated', () => {
  assert.equal(
    parseAiAssistArgs(['--state-text', '--state-format', 'panels']).stateFormat,
    'panels'
  );
  assert.equal(
    parseAiAssistArgs(['--state-text', '--state-format', 'flat']).stateFormat,
    'flat'
  );
  assert.throws(
    () => parseAiAssistArgs(['--state-text', '--state-format', 'bogus']),
    /--state-format must be flat or panels/
  );
  assert.throws(
    () => parseAiAssistArgs(['--state-format', 'panels']),
    /--state-format requires --state-text/
  );
  assert.throws(
    () => parseAiAssistArgs(['--state-format', 'flat']),
    /--state-format requires --state-text/
  );
});

test('--monochrome is parsed and rejects combination with --state-text', () => {
  assert.equal(parseAiAssistArgs(['--monochrome']).monochrome, true);
  assert.equal(
    parseAiAssistArgs(['--append-image', '--monochrome']).monochrome,
    true
  );
  assert.throws(
    () => parseAiAssistArgs(['--state-text', '--monochrome']),
    /--monochrome and --state-text cannot be combined/
  );
});

test('run summary aggregates grounding statuses per case and overall', () => {
  const summary = summarizeAiAssistRuns([
    {
      caseId: 'a',
      quality: {score: 1, passed: true},
      metrics: {},
      grounding: {status: 'ok'},
    },
    {
      caseId: 'a',
      quality: {score: 1, passed: true},
      metrics: {},
      grounding: {status: 'rejected', reason: 'unverifiable command: kubectl'},
    },
    {
      caseId: 'a',
      quality: {score: 1, passed: true},
      metrics: {},
      grounding: {status: 'unverified', reason: 'chat-prose'},
    },
    {
      caseId: 'b',
      quality: {score: 1, passed: true},
      metrics: {},
    },
  ]);
  assert.deepEqual(summary.grounding, {
    total: 3,
    ok: 1,
    repaired: 0,
    rejected: 1,
    unverified: 1,
    no_next_step: 0,
  });
  const caseA = summary.byCase.find((item) => item.caseId === 'a');
  assert.deepEqual(caseA.grounding, {
    total: 3,
    ok: 1,
    repaired: 0,
    rejected: 1,
    unverified: 1,
    no_next_step: 0,
  });
  const caseB = summary.byCase.find((item) => item.caseId === 'b');
  assert.equal(caseB.grounding, undefined);
});

test('run summary reports passRateAfterGrounding alongside the raw pass rate', () => {
  const summary = summarizeAiAssistRuns([
    {
      caseId: 'a',
      quality: {score: 1, passed: true},
      qualityAfterGrounding: {score: 1, passed: true},
      metrics: {},
      grounding: {status: 'ok'},
    },
    {
      caseId: 'a',
      // raw score looks passing, but the rejected command degrades the
      // grounded answer to a failing one.
      quality: {score: 1, passed: true},
      qualityAfterGrounding: {score: 0, passed: false},
      metrics: {},
      grounding: {status: 'rejected', reason: 'unverifiable command: kubectl'},
    },
  ]);
  assert.equal(summary.allRunPassRate, 1);
  assert.equal(summary.passRateAfterGrounding, 0.5);
  const caseA = summary.byCase.find((item) => item.caseId === 'a');
  assert.equal(caseA.passRate, 1);
  assert.equal(caseA.passRateAfterGrounding, 0.5);
});

test('passRateAfterGrounding is omitted when grounding was never applied', () => {
  const summary = summarizeAiAssistRuns([
    {caseId: 'a', quality: {score: 1, passed: true}, metrics: {}},
  ]);
  assert.equal(summary.passRateAfterGrounding, undefined);
  assert.equal(summary.byCase[0].passRateAfterGrounding, undefined);
});

test('case validation rejects ambiguous fixtures early', () => {
  assert.equal(
    validateAiAssistCases({
      cases: [
        {id: 'one', question: '状況は?', rubric: {requiredAny: [['停止']]}},
      ],
    }).length,
    1
  );
  assert.throws(() => validateAiAssistCases({cases: []}), /must not be empty/);
  assert.throws(
    () =>
      validateAiAssistCases({
        cases: [
          {id: 'one', question: 'a'},
          {id: 'one', question: 'b'},
        ],
      }),
    /duplicate case id/
  );
});

test('quality scoring handles evidence alternatives and hallucination vetoes', () => {
  const testCase = {
    rubric: {
      requiredAll: ['次の一手'],
      requiredAny: [
        ['stopped', '停止'],
        ['restart', '再起動'],
      ],
      forbidden: ['データベース障害'],
      passThreshold: 0.8,
    },
  };
  const good = scoreAiAssistResponse(
    testCase,
    'API は STOPPED です。次の一手として restart を実行します。'
  );
  assert.equal(good.score, 1);
  assert.equal(good.passed, true);

  const hallucinated = scoreAiAssistResponse(
    testCase,
    '停止を確認。次の一手は再起動です。データベース障害もあります。'
  );
  assert.equal(hallucinated.passed, false);
  assert.equal(
    hallucinated.checks.find((check) => check.kind === 'forbidden').passed,
    false
  );

  const careful = scoreAiAssistResponse(
    testCase,
    '停止とは判断できません。データベース障害ではありません。次の一手を検討します。'
  );
  assert.equal(
    careful.checks.find((check) => check.kind === 'forbidden').passed,
    true
  );
  assert.equal(
    careful.checks.find((check) => check.kind === 'requiredAny').passed,
    false
  );

  const evidenceQualified = scoreAiAssistResponse(
    testCase,
    '停止の証拠はありません。データベース障害の証拠もありません。次の一手を検討します。'
  );
  assert.equal(
    evidenceQualified.checks.find((check) => check.kind === 'forbidden').passed,
    true
  );
  assert.equal(
    evidenceQualified.checks.find((check) => check.kind === 'requiredAny')
      .passed,
    false
  );
});

test('next-step section is extracted between the first 次の一手 and 根拠 markers', () => {
  const testCase = {
    rubric: {
      nextStepRequiredAny: [['ss -ltnp']],
      nextStepForbidden: ['yamactl restart api'],
    },
  };

  const withEvidenceSection = scoreAiAssistResponse(
    testCase,
    '状況はポート競合の疑いです。次の一手: ss -ltnp を実行して占有プロセスを確認する。根拠: health が unknown service identity のまま。'
  );
  assert.equal(
    withEvidenceSection.checks.find(
      (check) => check.kind === 'nextStepRequiredAny'
    ).passed,
    true
  );

  const withoutEvidenceMarker = scoreAiAssistResponse(
    testCase,
    '状況はポート競合の疑いです。次の一手: ss -ltnp を実行して占有プロセスを確認する。'
  );
  assert.equal(
    withoutEvidenceMarker.checks.find(
      (check) => check.kind === 'nextStepRequiredAny'
    ).passed,
    true
  );

  const withoutNextStepMarker = scoreAiAssistResponse(
    testCase,
    'ss -ltnp を実行して占有プロセスを確認する。'
  );
  assert.equal(
    withoutNextStepMarker.checks.find(
      (check) => check.kind === 'nextStepRequiredAny'
    ).passed,
    false
  );
});

test('nextStepRequiredAny and nextStepForbidden score only the 次の一手 section', () => {
  const testCase = {
    rubric: {
      nextStepRequiredAny: [['fake-db-stats.json']],
      nextStepForbidden: ['再起動'],
      passThreshold: 0.85,
    },
  };

  // Regression: the whole response mentions both 犯人 and 40, so a naive
  // whole-response rubric would score this misleading answer at 1.0. Scoring
  // only the 次の一手 section must catch the wrong recommendation.
  const misleadingRestart = scoreAiAssistResponse(
    testCase,
    'DB Conn は 40/40 で犯人プロセスが疑われます。次の一手: DB を再起動して、犯人が生きていればすぐ再発する を実行する。'
  );
  assert.equal(
    misleadingRestart.checks.find((check) => check.kind === 'nextStepForbidden')
      .passed,
    false
  );
  assert.equal(misleadingRestart.passed, false);

  const correctInvestigation = scoreAiAssistResponse(
    testCase,
    'DB Conn は 40/40 で犯人プロセスが疑われます。次の一手: cat /workspace/run/fake-db-stats.json で犯人プロセスを特定する。'
  );
  assert.equal(
    correctInvestigation.checks.find(
      (check) => check.kind === 'nextStepRequiredAny'
    ).passed,
    true
  );
  assert.equal(
    correctInvestigation.checks.find(
      (check) => check.kind === 'nextStepForbidden'
    ).passed,
    true
  );
});

test('rubrics without next-step fields score identically to before the extension', () => {
  const testCase = {
    rubric: {
      requiredAll: ['次の一手'],
      requiredAny: [
        ['stopped', '停止'],
        ['restart', '再起動'],
      ],
      forbidden: ['データベース障害'],
      passThreshold: 0.8,
    },
  };
  const response = '停止を確認。次の一手は再起動です。';
  const result = scoreAiAssistResponse(testCase, response);
  assert.equal(result.score, 1);
  assert.equal(result.passed, true);
  assert.equal(result.checkCount, 5);
  assert.equal(
    result.checks.some(
      (check) =>
        check.kind === 'nextStepRequiredAny' ||
        check.kind === 'nextStepForbidden'
    ),
    false
  );
});

test('numeric summaries use nearest-rank median and p95', () => {
  assert.deepEqual(summarizeNumbers([1, 2, 3, 4, 100]), {
    count: 5,
    min: 1,
    median: 3,
    p95: 100,
    max: 100,
    mean: 22,
  });
  assert.deepEqual(summarizeNumbers([]), {count: 0});
});

test('run summary separates errors from quality and latency', () => {
  const summary = summarizeAiAssistRuns([
    {
      quality: {score: 1, passed: true},
      metrics: {
        sessionCreateMs: 10,
        ttftMs: 20,
        totalMs: 40,
        charsPerSecond: 100,
      },
    },
    {
      quality: {score: 0.5, passed: false},
      metrics: {
        sessionCreateMs: 20,
        ttftMs: 40,
        totalMs: 80,
        charsPerSecond: 50,
      },
    },
    {error: {message: 'timeout'}, metrics: {}},
  ]);
  assert.equal(summary.runCount, 3);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.successfulRunPassRate, 0.5);
  assert.equal(summary.allRunPassRate, 0.333);
  assert.equal(summary.casePassRate, 0);
  assert.equal(summary.meanQualityScore, 0.75);
  assert.equal(summary.ttftMs.median, 20);
});

test('run summary aggregates appendMs only when present in metrics', () => {
  const withAppend = summarizeAiAssistRuns([
    {
      quality: {score: 1, passed: true},
      metrics: {sessionCreateMs: 10, appendMs: 300, ttftMs: 20, totalMs: 40},
    },
    {
      quality: {score: 1, passed: true},
      metrics: {sessionCreateMs: 10, appendMs: 500, ttftMs: 20, totalMs: 40},
    },
  ]);
  assert.deepEqual(withAppend.appendMs, {
    count: 2,
    min: 300,
    median: 300,
    p95: 500,
    max: 500,
    mean: 400,
  });

  const withoutAppend = summarizeAiAssistRuns([
    {
      quality: {score: 1, passed: true},
      metrics: {sessionCreateMs: 10, ttftMs: 20, totalMs: 40},
    },
  ]);
  assert.deepEqual(withoutAppend.appendMs, {count: 0});
});
