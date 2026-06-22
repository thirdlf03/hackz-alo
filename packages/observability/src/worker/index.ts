import {
  ConsolePerfSink,
  createPerfController,
  exporterFromValue,
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  MemoryPerfSink,
  noopPerfController,
  perfEnabledFromValue,
  sqlOperation,
  sqlStatementSummary,
  type ActivePerfSpan,
  type PerfAttributes,
  type PerfConfig,
  type PerfController,
  type PerfSnapshot,
} from '../core/index.js';

interface WorkerPerfEnv {
  INCIDENT_PERF?: string;
  DB?: D1Database;
}

interface MiddlewareRequest {
  raw: Request;
  header(name: string): string | undefined;
}

interface MiddlewareContext {
  env: WorkerPerfEnv;
  req: MiddlewareRequest;
  res: Response;
  header(name: string, value: string): void;
}

type MiddlewareNext = () => Promise<void>;

const workerMemorySink = new MemoryPerfSink(1000);
const instrumentedDbs = new WeakMap<D1Database, D1Database>();
const instrumentedDbProxies = new WeakSet<D1Database>();
const statementTargets = new WeakMap<object, D1PreparedStatement>();
const instrumentedStatementProxies = new WeakSet<D1PreparedStatement>();
let workerPerf: PerfController = noopPerfController;
let workerPerfKey = '';

export function createWorkerPerf(env: WorkerPerfEnv): PerfController {
  const enabled = perfEnabledFromValue(env.INCIDENT_PERF);
  if (!enabled) return noopPerfController;
  const exporter = exporterFromValue(env.INCIDENT_PERF);
  const key = `${exporter}:incident-worker`;
  if (!workerPerf.enabled || workerPerfKey !== key) {
    workerPerf = createPerfController(
      {
        enabled,
        runtime: 'worker',
        serviceName: 'incident-worker',
        exporter,
      } satisfies PerfConfig,
      exporter === 'memory' ? workerMemorySink : new ConsolePerfSink()
    );
    workerPerfKey = key;
  }
  return workerPerf;
}

export function resetWorkerPerfForTests() {
  workerMemorySink.clear();
  workerPerf = noopPerfController;
  workerPerfKey = '';
}

export function workerPerfSnapshot(): PerfSnapshot {
  return workerPerf.snapshot();
}

export function perfMiddleware() {
  return async (c: MiddlewareContext, next: MiddlewareNext) => {
    const perf = createWorkerPerf(c.env);
    if (!perf.enabled) {
      await next();
      return;
    }
    if (c.env.DB) c.env.DB = instrumentD1(c.env.DB, perf);

    const request = c.req.raw;
    const url = new URL(request.url);
    const startedAt = nowMs();
    await perf.withSpan(
      INCIDENT_SPAN_NAMES.httpRequest,
      {
        parentTraceparent: c.req.header('traceparent'),
        attributes: {
          [INCIDENT_ATTRS.httpMethod]: request.method,
          [INCIDENT_ATTRS.httpTarget]: url.pathname,
          [INCIDENT_ATTRS.httpRoute]: url.pathname,
          [INCIDENT_ATTRS.requestId]: c.req.header('x-request-id'),
        },
      },
      async (span) => {
        try {
          await next();
          span.setAttribute(INCIDENT_ATTRS.httpStatusCode, c.res.status);
        } finally {
          const durationMs = nowMs() - startedAt;
          c.header('Server-Timing', serverTimingHeader(durationMs));
        }
      }
    );
  };
}

export function instrumentD1(
  db: D1Database,
  perf: PerfController = workerPerf
): D1Database {
  if (!perf.enabled) return db;
  if (instrumentedDbProxies.has(db)) return db;
  const cached = instrumentedDbs.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => wrapStatement(target.prepare(sql), perf, sql);
      }
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) =>
          await perf.withSpan(
            INCIDENT_SPAN_NAMES.d1Batch,
            {
              attributes: {
                [INCIDENT_ATTRS.dbSystem]: 'cloudflare-d1',
                [INCIDENT_ATTRS.dbOperation]: 'BATCH',
                [INCIDENT_ATTRS.dbStatementCount]: statements.length,
              },
            },
            async () => await target.batch(statements.map(unwrapStatement))
          );
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  instrumentedDbs.set(db, proxy);
  instrumentedDbs.set(proxy, proxy);
  instrumentedDbProxies.add(proxy);
  return proxy;
}

export function traceHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  const traceparent = workerPerf.currentTraceparent();
  if (traceparent) next.set('traceparent', traceparent);
  return next;
}

export function currentWorkerTraceparent() {
  return workerPerf.currentTraceparent();
}

export async function withWorkerSpan<T>(
  env: WorkerPerfEnv,
  name: string,
  attributes: PerfAttributes | undefined,
  run: (span: ActivePerfSpan) => T | Promise<T>,
  parentTraceparent?: string
): Promise<T> {
  const perf = createWorkerPerf(env);
  if (!perf.enabled) return await run(noopPerfController.startSpan(name));
  return await perf.withSpan(name, {parentTraceparent, attributes}, run);
}

export function serverTimingHeader(durationMs: number) {
  return `incident_app;dur=${durationMs.toFixed(1)};desc="Incident app"`;
}

function wrapStatement(
  statement: D1PreparedStatement,
  perf: PerfController,
  sql: string
): D1PreparedStatement {
  if (instrumentedStatementProxies.has(statement)) return statement;
  const targetStatement = unwrapStatement(statement);
  const proxy = new Proxy(statement, {
    get(target, property, receiver) {
      if (property === 'bind') {
        return (...values: unknown[]) =>
          wrapStatement(target.bind(...values), perf, sql);
      }
      if (isD1ExecutionMethod(property)) {
        const method = Reflect.get(target, property, receiver);
        if (typeof method !== 'function') return method as unknown;
        return async (...args: unknown[]) =>
          await perf.withSpan<unknown>(
            INCIDENT_SPAN_NAMES.d1Query,
            {
              attributes: {
                [INCIDENT_ATTRS.dbSystem]: 'cloudflare-d1',
                [INCIDENT_ATTRS.dbOperation]: sqlOperation(sql),
                [INCIDENT_ATTRS.dbStatementSummary]: sqlStatementSummary(sql),
              },
            },
            async () => (await Reflect.apply(method, target, args)) as unknown
          );
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  statementTargets.set(proxy, targetStatement);
  instrumentedStatementProxies.add(proxy);
  return proxy;
}

function unwrapStatement(statement: D1PreparedStatement): D1PreparedStatement {
  return statementTargets.get(statement) ?? statement;
}

function isD1ExecutionMethod(
  property: string | symbol
): property is 'run' | 'first' | 'all' | 'raw' {
  return (
    property === 'run' ||
    property === 'first' ||
    property === 'all' ||
    property === 'raw'
  );
}

function nowMs(): number {
  return globalThis.performance.now();
}

export {INCIDENT_SPAN_NAMES, INCIDENT_ATTRS};
