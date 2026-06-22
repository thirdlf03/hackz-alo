export type PerfRuntime = 'browser' | 'worker' | 'node';
export type PerfExporter = 'noop' | 'console' | 'memory' | 'otlp-stub';
export type PerfStatus = 'ok' | 'error';
export type PerfAttributeValue = string | number | boolean;
export type PerfAttributes = Record<string, PerfAttributeValue | undefined>;

export interface PerfConfig {
  enabled: boolean;
  runtime: PerfRuntime;
  serviceName: string;
  exporter: PerfExporter;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export interface PerfSpanRecord {
  schemaVersion: 1;
  type: 'span';
  name: string;
  runtime: PerfRuntime;
  serviceName: string;
  traceId: string;
  spanId: string;
  traceparent: string;
  parentSpanId?: string | undefined;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  status: PerfStatus;
  attributes: Record<string, PerfAttributeValue>;
  errorMessage?: string | undefined;
}

export interface PerfMarkRecord {
  schemaVersion: 1;
  type: 'mark';
  name: string;
  runtime: PerfRuntime;
  serviceName: string;
  timestampUnixMs: number;
  attributes: Record<string, PerfAttributeValue>;
}

export interface PerfFrameSample {
  schemaVersion: 1;
  type: 'frame';
  runtime: 'browser';
  serviceName: string;
  timestampUnixMs: number;
  drawMs: number;
  tickMs?: number | undefined;
}

export interface PerfFrameStats {
  fps: number;
  lastDrawMs: number;
  p95DrawMs: number;
  slowDrawCount: number;
  sampleCount: number;
}

export interface BrowserPerformanceEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}

export interface PerfSnapshot {
  enabled: boolean;
  runtime: PerfRuntime;
  serviceName: string;
  spans: PerfSpanRecord[];
  marks: PerfMarkRecord[];
  frameSamples: PerfFrameSample[];
  frameStats: PerfFrameStats;
  lastJourneyMark?: string | undefined;
  performanceEntries?: BrowserPerformanceEntry[] | undefined;
}

export interface PerfStartOptions {
  parentTraceparent?: string | undefined;
  attributes?: PerfAttributes | undefined;
}

export interface PerfEndOptions {
  status?: PerfStatus | undefined;
  attributes?: PerfAttributes | undefined;
  error?: unknown;
}

export interface ActivePerfSpan {
  readonly name: string;
  readonly traceContext: TraceContext;
  readonly traceparent: string;
  readonly ended: boolean;
  setAttribute(key: string, value: PerfAttributeValue | undefined): void;
  setAttributes(attributes: PerfAttributes): void;
  end(options?: PerfEndOptions): PerfSpanRecord | undefined;
}

export interface PerfController {
  readonly enabled: boolean;
  startSpan(name: string, options?: PerfStartOptions): ActivePerfSpan;
  withSpan<T>(
    name: string,
    options: PerfStartOptions | undefined,
    run: (span: ActivePerfSpan) => T | Promise<T>
  ): Promise<T>;
  mark(name: string, attributes?: PerfAttributes): PerfMarkRecord | undefined;
  recordFrameSample(sample: {drawMs: number; tickMs?: number}): void;
  snapshot(): PerfSnapshot;
  currentTraceparent(): string | undefined;
}

export const INCIDENT_SPAN_NAMES = {
  apiRequest: 'incident.app.api.request',
  httpRequest: 'incident.app.http.request',
  doRequest: 'incident.app.do.request',
  doSnapshotPoll: 'incident.app.do.snapshot_poll',
  d1Query: 'incident.app.d1.query',
  d1Batch: 'incident.app.d1.batch',
  sandboxPrepare: 'incident.app.sandbox.prepare',
  sandboxStart: 'incident.app.sandbox.start',
  sandboxExec: 'incident.app.sandbox.exec',
  sandboxTerminalProxy: 'incident.app.sandbox.terminal_proxy',
  sandboxFileRead: 'incident.app.sandbox.file_read',
  sandboxFileWrite: 'incident.app.sandbox.file_write',
  canvasDraw: 'incident.app.canvas.draw',
  gameTick: 'incident.app.game.tick',
  journeyScenariosLoaded: 'incident.app.journey.scenarios_loaded',
  journeyBriefingReady: 'incident.app.journey.briefing_ready',
  journeySessionCreated: 'incident.app.journey.session_created',
  journeyGameStarted: 'incident.app.journey.game_started',
  journeyCanvasFirstDraw: 'incident.app.journey.canvas_first_draw',
  journeyTerminalReady: 'incident.app.journey.terminal_ready',
  journeyRecordingChunkUploaded:
    'incident.app.journey.recording_chunk_uploaded',
} as const;

export const INCIDENT_ATTRS = {
  runtime: 'incident.runtime',
  requestId: 'incident.request_id',
  httpMethod: 'http.method',
  httpRoute: 'http.route',
  httpTarget: 'http.target',
  httpStatusCode: 'http.status_code',
  doAction: 'incident.do.action',
  dbSystem: 'db.system',
  dbOperation: 'db.operation',
  dbStatementSummary: 'db.statement.summary',
  dbStatementCount: 'db.statement.count',
  sandboxCommandKind: 'incident.sandbox.command_kind',
  sandboxProcessId: 'incident.sandbox.process_id',
  scenarioId: 'incident.scenario_id',
  sessionId: 'incident.session_id',
  replayId: 'incident.replay_id',
  cached: 'incident.cached',
  drawMs: 'incident.draw_ms',
  tickMs: 'incident.tick_ms',
} as const;

export const noopPerfController: PerfController = {
  enabled: false,
  startSpan(name: string): ActivePerfSpan {
    return new NoopSpan(name);
  },
  async withSpan<T>(
    _name: string,
    _options: PerfStartOptions | undefined,
    run: (span: ActivePerfSpan) => T | Promise<T>
  ): Promise<T> {
    return await run(new NoopSpan(_name));
  },
  mark() {
    return undefined;
  },
  recordFrameSample() {
    // no-op
  },
  snapshot() {
    return emptySnapshot('node', 'incident-training', false);
  },
  currentTraceparent() {
    return undefined;
  },
};

export interface PerfSink {
  emitSpan(record: PerfSpanRecord): void;
  emitMark(record: PerfMarkRecord): void;
  emitFrameSample(record: PerfFrameSample): void;
  snapshot(config: PerfConfig): PerfSnapshot;
}

export class MemoryPerfSink implements PerfSink {
  private spans: PerfSpanRecord[] = [];
  private marks: PerfMarkRecord[] = [];
  private frameSamples: PerfFrameSample[] = [];

  constructor(private readonly maxRecords = 500) {}

  emitSpan(record: PerfSpanRecord) {
    this.spans = appendBounded(this.spans, record, this.maxRecords);
  }

  emitMark(record: PerfMarkRecord) {
    this.marks = appendBounded(this.marks, record, this.maxRecords);
  }

  emitFrameSample(record: PerfFrameSample) {
    this.frameSamples = appendBounded(
      this.frameSamples,
      record,
      this.maxRecords
    );
  }

  snapshot(config: PerfConfig): PerfSnapshot {
    return {
      enabled: config.enabled,
      runtime: config.runtime,
      serviceName: config.serviceName,
      spans: [...this.spans],
      marks: [...this.marks],
      frameSamples: [...this.frameSamples],
      frameStats: frameStats(this.frameSamples),
      lastJourneyMark: this.marks.at(-1)?.name,
    };
  }

  clear() {
    this.spans = [];
    this.marks = [];
    this.frameSamples = [];
  }
}

export class ConsolePerfSink implements PerfSink {
  emitSpan(record: PerfSpanRecord) {
    console.log(JSON.stringify({event: 'incident_perf_span', ...record}));
  }

  emitMark(record: PerfMarkRecord) {
    console.log(JSON.stringify({event: 'incident_perf_mark', ...record}));
  }

  emitFrameSample(_record: PerfFrameSample) {
    // Frame samples are browser-only in v1.
  }

  snapshot(config: PerfConfig): PerfSnapshot {
    return emptySnapshot(config.runtime, config.serviceName, config.enabled);
  }
}

export function createPerfController(
  config: PerfConfig,
  sink: PerfSink
): PerfController {
  if (!config.enabled) return noopPerfController;
  return new RuntimePerfController(config, sink);
}

export function emptySnapshot(
  runtime: PerfRuntime,
  serviceName: string,
  enabled: boolean
): PerfSnapshot {
  return {
    enabled,
    runtime,
    serviceName,
    spans: [],
    marks: [],
    frameSamples: [],
    frameStats: {
      fps: 0,
      lastDrawMs: 0,
      p95DrawMs: 0,
      slowDrawCount: 0,
      sampleCount: 0,
    },
  };
}

export function perfEnabledFromValue(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'console', 'memory', 'otlp-stub'].includes(
    value.toLowerCase()
  );
}

export function exporterFromValue(value: string | undefined): PerfExporter {
  if (value === 'memory' || value === 'otlp-stub' || value === 'console') {
    return value;
  }
  return perfEnabledFromValue(value) ? 'console' : 'noop';
}

export function browserExporterFromValue(
  value: string | undefined
): PerfExporter {
  if (value === 'console' || value === 'otlp-stub') return value;
  return perfEnabledFromValue(value) ? 'memory' : 'noop';
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

export function parseTraceparent(
  value: string | undefined
): TraceContext | undefined {
  if (!value) return undefined;
  const match = value
    .trim()
    .match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!match) return undefined;
  const traceId = match[1]?.toLowerCase();
  const spanId = match[2]?.toLowerCase();
  const flags = match[3]?.toLowerCase();
  if (!traceId || !spanId || traceId === '0'.repeat(32)) return undefined;
  if (spanId === '0'.repeat(16)) return undefined;
  return {
    traceId,
    spanId,
    sampled: flags === '01',
  };
}

export function createChildTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    sampled: parent?.sampled ?? true,
  };
}

export function normalizeAttributes(
  attributes: PerfAttributes | undefined
): Record<string, PerfAttributeValue> {
  const normalized: Record<string, PerfAttributeValue> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) normalized[key] = value;
  }
  return normalized;
}

export function sqlOperation(sql: string): string {
  return sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? 'UNKNOWN';
}

export function sqlStatementSummary(sql: string): string {
  const compact = sql.trim().replace(/\s+/g, ' ');
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

export function frameStats(samples: PerfFrameSample[]): PerfFrameStats {
  const drawSamples = samples.map((sample) => sample.drawMs);
  const last = samples.at(-1);
  const previous = samples.at(-2);
  const fps =
    last && previous
      ? Math.round(
          1000 / Math.max(1, last.timestampUnixMs - previous.timestampUnixMs)
        )
      : 0;
  return {
    fps,
    lastDrawMs: roundOne(last?.drawMs ?? 0),
    p95DrawMs: roundOne(percentile(drawSamples, 0.95)),
    slowDrawCount: drawSamples.filter((value) => value >= 50).length,
    sampleCount: samples.length,
  };
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1)
  );
  return sorted[index] ?? 0;
}

export function formatError(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (error === undefined) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean') {
    return String(error);
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return '[object]';
    }
  }
  return `[${typeof error}]`;
}

class RuntimePerfController implements PerfController {
  private activeContext: TraceContext | undefined;

  constructor(
    private readonly config: PerfConfig,
    private readonly sink: PerfSink
  ) {}

  get enabled() {
    return this.config.enabled;
  }

  startSpan(name: string, options?: PerfStartOptions): ActivePerfSpan {
    const parent =
      parseTraceparent(options?.parentTraceparent) ?? this.activeContext;
    const context = createChildTraceContext(parent);
    return new RuntimeSpan(
      this.config,
      this.sink,
      name,
      context,
      parent,
      options
    );
  }

  async withSpan<T>(
    name: string,
    options: PerfStartOptions | undefined,
    run: (span: ActivePerfSpan) => T | Promise<T>
  ): Promise<T> {
    const span = this.startSpan(name, options);
    const previous = this.activeContext;
    this.activeContext = span.traceContext;
    try {
      const result = await run(span);
      span.end();
      return result;
    } catch (error) {
      span.end({status: 'error', error});
      throw error;
    } finally {
      this.activeContext = previous;
    }
  }

  mark(name: string, attributes?: PerfAttributes): PerfMarkRecord {
    const record = {
      schemaVersion: 1,
      type: 'mark',
      name,
      runtime: this.config.runtime,
      serviceName: this.config.serviceName,
      timestampUnixMs: Date.now(),
      attributes: normalizeAttributes(attributes),
    } satisfies PerfMarkRecord;
    this.sink.emitMark(record);
    return record;
  }

  recordFrameSample(sample: {drawMs: number; tickMs?: number}) {
    if (this.config.runtime !== 'browser') return;
    const record = {
      schemaVersion: 1,
      type: 'frame',
      runtime: 'browser',
      serviceName: this.config.serviceName,
      timestampUnixMs: Date.now(),
      drawMs: sample.drawMs,
      ...(sample.tickMs === undefined ? {} : {tickMs: sample.tickMs}),
    } satisfies PerfFrameSample;
    this.sink.emitFrameSample(record);
  }

  snapshot(): PerfSnapshot {
    return this.sink.snapshot(this.config);
  }

  currentTraceparent(): string | undefined {
    return this.activeContext
      ? formatTraceparent(this.activeContext)
      : undefined;
  }
}

class RuntimeSpan implements ActivePerfSpan {
  private readonly startTimeUnixMs = Date.now();
  private readonly startedAtMs = nowMs();
  private attributes: Record<string, PerfAttributeValue>;
  private didEnd = false;

  constructor(
    private readonly config: PerfConfig,
    private readonly sink: PerfSink,
    readonly name: string,
    readonly traceContext: TraceContext,
    private readonly parent: TraceContext | undefined,
    options: PerfStartOptions | undefined
  ) {
    this.attributes = normalizeAttributes(options?.attributes);
  }

  get traceparent() {
    return formatTraceparent(this.traceContext);
  }

  get ended() {
    return this.didEnd;
  }

  setAttribute(key: string, value: PerfAttributeValue | undefined) {
    if (value === undefined) {
      const {[key]: _removed, ...rest} = this.attributes;
      this.attributes = rest;
      return;
    }
    this.attributes[key] = value;
  }

  setAttributes(attributes: PerfAttributes) {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
  }

  end(options?: PerfEndOptions): PerfSpanRecord | undefined {
    if (this.didEnd) return undefined;
    this.didEnd = true;
    this.setAttributes(options?.attributes ?? {});
    const durationMs = Math.max(0, nowMs() - this.startedAtMs);
    const record = {
      schemaVersion: 1,
      type: 'span',
      name: this.name,
      runtime: this.config.runtime,
      serviceName: this.config.serviceName,
      traceId: this.traceContext.traceId,
      spanId: this.traceContext.spanId,
      traceparent: this.traceparent,
      ...(this.parent?.spanId === undefined
        ? {}
        : {parentSpanId: this.parent.spanId}),
      startTimeUnixMs: this.startTimeUnixMs,
      endTimeUnixMs: this.startTimeUnixMs + durationMs,
      durationMs: roundOne(durationMs),
      status: options?.status ?? (options?.error ? 'error' : 'ok'),
      attributes: {...this.attributes},
      ...(formatError(options?.error) === undefined
        ? {}
        : {errorMessage: formatError(options?.error)}),
    } satisfies PerfSpanRecord;
    this.sink.emitSpan(record);
    return record;
  }
}

class NoopSpan implements ActivePerfSpan {
  readonly traceContext = {
    traceId: '0'.repeat(32),
    spanId: '0'.repeat(16),
    sampled: false,
  };
  readonly traceparent = formatTraceparent(this.traceContext);
  readonly ended = false;

  constructor(readonly name: string) {}

  setAttribute() {
    // no-op
  }

  setAttributes() {
    // no-op
  }

  end() {
    return undefined;
  }
}

function appendBounded<T>(items: T[], item: T, maxRecords: number): T[] {
  const next = [...items, item];
  return next.length > maxRecords ? next.slice(next.length - maxRecords) : next;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function nowMs(): number {
  return globalThis.performance.now();
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
