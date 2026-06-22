import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {
  percentile,
  INCIDENT_SPAN_NAMES,
  type PerfFrameSample,
  type PerfMarkRecord,
  type PerfSpanRecord,
} from '../core/index.js';

export interface PerfReport {
  generatedAt: string;
  spans: {
    count: number;
    byName: Array<{
      name: string;
      count: number;
      avgMs: number;
      p95Ms: number;
      maxMs: number;
    }>;
  };
  marks: Array<{name: string; count: number}>;
  frames: {
    count: number;
    p95DrawMs: number;
    slowDrawCount: number;
  };
  benchmarks?: Record<string, BenchmarkResult>;
}

export interface BenchmarkResult {
  iterations: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
}

export type PerfTraceRecord =
  | PerfSpanRecord
  | PerfMarkRecord
  | PerfFrameSample
  | {event?: string; type?: string; [key: string]: unknown};

export async function readTraceJsonl(filePath: string) {
  const content = await readFile(filePath, 'utf8').catch((error: unknown) => {
    if (isNotFound(error)) return '';
    throw error;
  });
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PerfTraceRecord);
}

export async function writeTraceJsonl(
  filePath: string,
  records: PerfTraceRecord[]
) {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(
    filePath,
    records.map((record) => JSON.stringify(record)).join('\n') +
      (records.length === 0 ? '' : '\n')
  );
}

export function buildPerfReport(input: {
  records: PerfTraceRecord[];
  benchmarks?: Record<string, BenchmarkResult>;
}): PerfReport {
  const spans = input.records.filter(isSpan);
  const marks = input.records.filter(isMark);
  const frames = input.records.filter(isFrame);
  return {
    generatedAt: new Date().toISOString(),
    spans: {
      count: spans.length,
      byName: spanSummaries(spans),
    },
    marks: markSummaries(marks),
    frames: {
      count: frames.length,
      p95DrawMs: roundThree(
        percentile(
          frames.map((item) => item.drawMs),
          0.95
        )
      ),
      slowDrawCount: frames.filter((item) => item.drawMs >= 50).length,
    },
    ...(input.benchmarks === undefined ? {} : {benchmarks: input.benchmarks}),
  };
}

export function comparePerfReports(
  current: PerfReport,
  baseline: PerfReport | undefined,
  options: {strict?: boolean} = {}
) {
  if (!baseline) {
    return {ok: true, findings: ['baseline not provided']};
  }
  const findings: string[] = [];
  for (const currentBench of Object.entries(current.benchmarks ?? {})) {
    const [name, result] = currentBench;
    const baselineResult = baseline.benchmarks?.[name];
    if (!baselineResult) continue;
    if (result.meanMs > baselineResult.meanMs * 1.25) {
      findings.push(
        `${name} mean ${result.meanMs.toFixed(3)}ms exceeded baseline ${baselineResult.meanMs.toFixed(3)}ms`
      );
    }
  }
  if (
    current.frames.p95DrawMs > 0 &&
    baseline.frames.p95DrawMs > 0 &&
    current.frames.p95DrawMs > baseline.frames.p95DrawMs * 1.25
  ) {
    findings.push(
      `frame p95 ${current.frames.p95DrawMs.toFixed(1)}ms exceeded baseline ${baseline.frames.p95DrawMs.toFixed(1)}ms`
    );
  }
  for (const spanName of [
    INCIDENT_SPAN_NAMES.sandboxPrepare,
    INCIDENT_SPAN_NAMES.sandboxStart,
  ]) {
    const currentP95 = spanP95(current, spanName);
    const baselineP95 = spanP95(baseline, spanName);
    if (
      currentP95 !== undefined &&
      baselineP95 !== undefined &&
      baselineP95 > 0 &&
      currentP95 > baselineP95 * 1.25
    ) {
      findings.push(
        `${spanName} p95 ${currentP95.toFixed(1)}ms exceeded baseline ${baselineP95.toFixed(1)}ms`
      );
    }
  }
  return {
    ok: findings.length === 0 || options.strict !== true,
    findings,
  };
}

function spanP95(report: PerfReport, name: string) {
  return report.spans.byName.find((span) => span.name === name)?.p95Ms;
}

function spanSummaries(spans: PerfSpanRecord[]) {
  const grouped = new Map<string, number[]>();
  for (const span of spans) {
    grouped.set(span.name, [
      ...(grouped.get(span.name) ?? []),
      span.durationMs,
    ]);
  }
  return [...grouped.entries()]
    .map(([name, values]) => ({
      name,
      count: values.length,
      avgMs: roundThree(
        values.reduce((sum, value) => sum + value, 0) / values.length
      ),
      p95Ms: roundThree(percentile(values, 0.95)),
      maxMs: roundThree(Math.max(...values)),
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function markSummaries(marks: PerfMarkRecord[]) {
  const grouped = new Map<string, number>();
  for (const mark of marks) {
    grouped.set(mark.name, (grouped.get(mark.name) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([name, count]) => ({name, count}))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function isSpan(record: PerfTraceRecord): record is PerfSpanRecord {
  return record.type === 'span';
}

function isMark(record: PerfTraceRecord): record is PerfMarkRecord {
  return record.type === 'mark';
}

function isFrame(record: PerfTraceRecord): record is PerfFrameSample {
  return record.type === 'frame';
}

function roundThree(value: number) {
  return Math.round(value * 1000) / 1000;
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as {code?: string}).code === 'ENOENT'
  );
}
