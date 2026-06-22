import {
  browserExporterFromValue,
  ConsolePerfSink,
  createPerfController,
  emptySnapshot,
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  MemoryPerfSink,
  noopPerfController,
  type BrowserPerformanceEntry,
  type PerfAttributes,
  type PerfConfig,
  type PerfController,
  type PerfExporter,
  type PerfSnapshot,
} from '../core/index.js';

declare global {
  interface Window {
    __incidentPerf?: {
      snapshot(): PerfSnapshot;
    };
  }
}

interface BrowserPerfState {
  controller: PerfController;
  memorySink: MemoryPerfSink;
  firstCanvasDrawRecorded: boolean;
}

type BrowserPerfGlobal = typeof globalThis & {
  __incidentBrowserPerfState?: BrowserPerfState;
};

export function initBrowserPerf(options: {
  enabled: boolean;
  exporter?: PerfExporter;
  serviceName?: string;
}) {
  const exporter =
    options.exporter ??
    browserExporterFromValue(
      typeof window === 'undefined'
        ? undefined
        : (window.localStorage.getItem('incident-perf-exporter') ?? undefined)
    );
  const config = {
    enabled: options.enabled,
    runtime: 'browser',
    serviceName: options.serviceName ?? 'incident-web',
    exporter,
  } satisfies PerfConfig;
  const state = browserState();
  state.controller = config.enabled
    ? createPerfController(config, sinkFor(exporter))
    : noopPerfController;
  if (config.enabled && typeof window !== 'undefined') {
    window.__incidentPerf = {
      snapshot: () => snapshotBrowserPerf(),
    };
  }
  return state.controller;
}

export function resetBrowserPerfForTests() {
  const state = browserState();
  state.memorySink.clear();
  state.controller = noopPerfController;
  state.firstCanvasDrawRecorded = false;
  if (typeof window !== 'undefined') delete window.__incidentPerf;
}

export function getBrowserPerf() {
  return browserState().controller;
}

export function isBrowserPerfActive() {
  return browserState().controller.enabled;
}

export function markJourney(name: string, attributes?: PerfAttributes) {
  const browserPerf = browserState().controller;
  if (!browserPerf.enabled) return undefined;
  performance.mark(name);
  return browserPerf.mark(name, attributes);
}

export function recordCanvasDraw(
  drawMs: number,
  attributes: PerfAttributes = {}
) {
  const state = browserState();
  const browserPerf = state.controller;
  if (!browserPerf.enabled) return;
  browserPerf.recordFrameSample({drawMs});
  if (!state.firstCanvasDrawRecorded) {
    state.firstCanvasDrawRecorded = true;
    markJourney(INCIDENT_SPAN_NAMES.journeyCanvasFirstDraw, {
      ...attributes,
      [INCIDENT_ATTRS.drawMs]: drawMs,
    });
    const span = browserPerf.startSpan(INCIDENT_SPAN_NAMES.canvasDraw, {
      attributes: {
        ...attributes,
        [INCIDENT_ATTRS.drawMs]: drawMs,
        first_draw: true,
      },
    });
    span.end();
    return;
  }
  if (drawMs < 50) return;
  const span = browserPerf.startSpan(INCIDENT_SPAN_NAMES.canvasDraw, {
    attributes: {
      ...attributes,
      [INCIDENT_ATTRS.drawMs]: drawMs,
      slow_draw: true,
    },
  });
  span.end();
}

export function recordGameTick(
  tickMs: number,
  attributes: PerfAttributes = {}
) {
  const browserPerf = browserState().controller;
  if (!browserPerf.enabled || tickMs < 50) return;
  const span = browserPerf.startSpan(INCIDENT_SPAN_NAMES.gameTick, {
    attributes: {
      ...attributes,
      [INCIDENT_ATTRS.tickMs]: tickMs,
    },
  });
  span.end();
}

export function snapshotBrowserPerf(): PerfSnapshot {
  const browserPerf = browserState().controller;
  const snapshot = browserPerf.enabled
    ? browserPerf.snapshot()
    : emptySnapshot('browser', 'incident-web', false);
  return {
    ...snapshot,
    performanceEntries: browserPerformanceEntries(),
  };
}

function sinkFor(exporter: PerfExporter) {
  if (exporter === 'console') return new ConsolePerfSink();
  return browserState().memorySink;
}

function browserState(): BrowserPerfState {
  const target = globalThis as BrowserPerfGlobal;
  if (!target.__incidentBrowserPerfState) {
    target.__incidentBrowserPerfState = {
      controller: noopPerfController,
      memorySink: new MemoryPerfSink(700),
      firstCanvasDrawRecorded: false,
    };
  }
  return target.__incidentBrowserPerfState;
}

function browserPerformanceEntries(): BrowserPerformanceEntry[] {
  if (typeof performance === 'undefined') return [];
  return performance
    .getEntries()
    .filter(
      (entry) => entry.entryType === 'mark' || entry.entryType === 'measure'
    )
    .map((entry) => ({
      name: entry.name,
      entryType: entry.entryType,
      startTime: Math.round(entry.startTime * 10) / 10,
      duration: Math.round(entry.duration * 10) / 10,
    }));
}

export {INCIDENT_ATTRS, INCIDENT_SPAN_NAMES};
export type {ActivePerfSpan, PerfSnapshot} from '../core/index.js';
