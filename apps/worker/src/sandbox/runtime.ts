import {getSandbox, type PtyOptions, type Sandbox} from '@cloudflare/sandbox';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {
  MetricsSnapshot,
  ScenarioDefinition,
  SuccessCondition,
} from '@incident/shared';
import {formatUnknown} from '@incident/shared';
import type {Bindings} from '../types.js';
import {installSandboxAssets} from './assets.js';
import {buildFaultCommand} from './faultCommands.js';
import {
  isWorkspacePath,
  normalizeEditableWorkspacePath,
  shellArg,
} from './pathSafety.js';
import {buildSuccessCheckCommand} from './successEvaluators.js';

export type SandboxRuntime = Sandbox;

const DEFAULT_SANDBOX_SLEEP_AFTER = '16m';
const SANDBOX_PREPARED_MARKER = '/workspace/run/.incident-prepared.json';

export function getSessionSandbox(
  env: Bindings,
  sessionId: string
): SandboxRuntime {
  return getSandbox(env.Sandbox, sessionSandboxName(sessionId), {
    sleepAfter: sandboxSleepAfter(env),
  });
}

function sandboxSleepAfter(env: Bindings) {
  const configured = env.INCIDENT_SANDBOX_SLEEP_AFTER?.trim();
  return configured || DEFAULT_SANDBOX_SLEEP_AFTER;
}

export async function proxySessionTerminal(
  env: Bindings,
  sessionId: string,
  request: Request,
  options?: PtyOptions
) {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxTerminalProxy,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: 'terminal_upgrade',
    },
    async () =>
      await (
        getSessionSandbox(env, sessionId) as SandboxRuntime & {
          terminal(
            request: Request,
            options?: PtyOptions
          ): Response | Promise<Response>;
        }
      ).terminal(request, options)
  );
}

export interface EditableFileEntry {
  path: string;
  size: number;
}

type SandboxFileApi = SandboxRuntime & {
  readFile(path: string): Promise<{content: string} | string>;
  writeFile(path: string, content: string): Promise<unknown>;
};

/**
 * Cloudflare Sandbox 0.12.x PTY (Bun.Terminal) echoes ^C but does not deliver
 * SIGINT to the foreground process group. Send INT to the interactive bash instead.
 */
export async function interruptSessionTerminal(
  env: Bindings,
  sessionId: string
) {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    'for pid in $(pgrep -x bash); do',
    '  args=$(ps -p "$pid" -o args= 2>/dev/null || continue)',
    '  case "$args" in *"--norc"*) continue ;; esac',
    '  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " ")',
    '  if [ -n "$pgid" ]; then kill -INT "-$pgid" 2>/dev/null || kill -INT "$pid" 2>/dev/null || true; fi',
    '  break',
    'done',
  ].join('\n');
  await withSandboxExecSpan(env, sessionId, 'terminal_interrupt', async () => {
    await sandbox.exec(`bash -lc ${shellArg(script)}`, {cwd: '/workspace'});
  });
}

export async function startScenarioSandbox(
  env: Bindings,
  sessionId: string,
  scenario: ScenarioDefinition
) {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxStart,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.scenarioId]: scenario.id,
    },
    async () => {
      await prepareScenarioSandbox(env, sessionId, scenario);
      const sandbox = getSessionSandbox(env, sessionId);
      const started: Array<{
        id: string;
        command: string;
        waitForPort?: number;
      }> = [];
      for (const process of scenario.startup) {
        await withSandboxExecSpan(
          env,
          sessionId,
          'startup_process',
          async () => {
            const child = await sandbox.startProcess(process.command, {
              processId: process.id,
              cwd: '/workspace',
              autoCleanup: false,
            });
            if (process.waitForPort !== undefined) {
              await child.waitForPort(process.waitForPort, {
                mode: 'tcp',
                timeout: 30_000,
              });
            }
          },
          process.id
        );
        started.push({
          id: process.id,
          command: process.command,
          ...(process.waitForPort === undefined
            ? {}
            : {waitForPort: process.waitForPort}),
        });
      }
      return started;
    }
  );
}

export interface SandboxPrepareResult {
  prepared: true;
  reused: boolean;
}

export async function prepareScenarioSandbox(
  env: Bindings,
  sessionId: string,
  scenario: ScenarioDefinition
): Promise<SandboxPrepareResult> {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxPrepare,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.scenarioId]: scenario.id,
    },
    async (span) => {
      const sandbox = getSessionSandbox(env, sessionId);
      const reused = await isSandboxPrepared(sandbox, scenario.id);
      span.setAttribute(INCIDENT_ATTRS.cached, reused);
      if (reused) return {prepared: true, reused};

      await installSandboxAssets(sandbox);
      await withSandboxExecSpan(env, sessionId, 'sandbox_setup', async () => {
        await sandbox.exec(
          'mkdir -p /workspace/logs /workspace/run && rm -f /workspace/run/api.down /workspace/logs/debug.log /workspace/logs/batch.log',
          {cwd: '/workspace'}
        );
      });
      await (sandbox as SandboxFileApi).writeFile(
        SANDBOX_PREPARED_MARKER,
        JSON.stringify({
          scenarioId: scenario.id,
          preparedAt: new Date().toISOString(),
        })
      );
      return {prepared: true, reused};
    }
  );
}

export async function fetchSessionMetrics(
  env: Bindings,
  sessionId: string
): Promise<MetricsSnapshot | null> {
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'metrics_export',
    async () =>
      await sandbox.exec('node /workspace/services/metrics/export.mjs', {
        cwd: '/workspace',
      })
  );
  if (!result.success || !result.stdout.trim()) {
    console.error('[sandbox-metrics]', compactSandboxExecFailure(result));
    return null;
  }
  try {
    return parseMetricsSnapshot(
      JSON.parse(result.stdout) as Record<string, unknown>
    );
  } catch (error) {
    console.error(
      '[sandbox-metrics]',
      compactSandboxExecFailure(result, error)
    );
    return null;
  }
}

export async function fetchSessionLogs(
  env: Bindings,
  sessionId: string,
  file: string,
  tail: number
): Promise<string[]> {
  const allowed = new Set(['access', 'app', 'batch']);
  if (!allowed.has(file)) return [];
  const path = `/workspace/logs/${file}.log`;
  const lines = Math.max(1, Math.min(200, Number.isFinite(tail) ? tail : 50));
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'logs_tail',
    async () => await sandbox.exec(`tail -n ${String(lines)} ${shellArg(path)}`)
  );
  if (!result.success || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

export async function fetchSessionStorage(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    "const fs=require('fs');const path=require('path');",
    "const run='/workspace/run';",
    'const entries=[];',
    "if(fs.existsSync(path.join(run,'api.down'))) entries.push({key:'api.down',value:fs.readFileSync(path.join(run,'api.down'),'utf8')});",
    "if(fs.existsSync(path.join(run,'db.pool.exhausted'))) entries.push({key:'db.pool.exhausted',value:'true'});",
    "if(fs.existsSync(path.join(run,'monitor.blind.json'))) entries.push({key:'monitor.blind',value:fs.readFileSync(path.join(run,'monitor.blind.json'),'utf8')});",
    "if(fs.existsSync(path.join(run,'job-queue.jsonl'))) entries.push({key:'job-queue',value:fs.readFileSync(path.join(run,'job-queue.jsonl'),'utf8').split('\\n').slice(-5).join('\\n')});",
    "if(fs.existsSync(path.join(run,'fake-db-stats.json'))) entries.push({key:'fake-db-stats',value:fs.readFileSync(path.join(run,'fake-db-stats.json'),'utf8').trim()});",
    'process.stdout.write(JSON.stringify(entries));',
  ].join('');
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'storage_snapshot',
    async () => await sandbox.exec(`node -e ${shellArg(script)}`)
  );
  if (!result.success || !result.stdout.trim()) return [];
  try {
    return JSON.parse(result.stdout) as Array<{key: string; value: string}>;
  } catch {
    return [];
  }
}

export async function listSessionFiles(
  env: Bindings,
  sessionId: string
): Promise<EditableFileEntry[]> {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    "const fs=require('fs');const path=require('path');",
    "const roots=['/workspace/services','/workspace/run'];",
    'const out=[];',
    'function walk(dir){',
    '  if(!fs.existsSync(dir)) return;',
    '  for(const name of fs.readdirSync(dir)){',
    '    const file=path.join(dir,name);',
    '    let stat;',
    '    try{stat=fs.statSync(file);}catch{continue;}',
    '    if(stat.isDirectory()){walk(file);continue;}',
    '    if(!stat.isFile()||stat.size>200000) continue;',
    '    out.push({path:file,size:stat.size});',
    '  }',
    '}',
    'for(const root of roots) walk(root);',
    'out.sort((a,b)=>a.path.localeCompare(b.path));',
    'process.stdout.write(JSON.stringify(out));',
  ].join('');
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'file_list',
    async () =>
      await sandbox.exec(`node -e ${shellArg(script)}`, {
        cwd: '/workspace',
      })
  );
  if (!result.success || !result.stdout.trim()) return [];
  try {
    const files = JSON.parse(result.stdout) as EditableFileEntry[];
    return files.filter(
      (file) => isWorkspacePath(file.path) && Number.isFinite(file.size)
    );
  } catch {
    return [];
  }
}

export async function readSessionFile(
  env: Bindings,
  sessionId: string,
  path: string
) {
  const safePath = normalizeEditableWorkspacePath(path);
  const sandbox = getSessionSandbox(env, sessionId) as SandboxFileApi;
  const file = await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxFileRead,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: 'file_read',
    },
    async () => await sandbox.readFile(safePath)
  );
  const content = typeof file === 'string' ? file : file.content;
  return {path: safePath, content};
}

export async function writeSessionFile(
  env: Bindings,
  sessionId: string,
  path: string,
  content: string
) {
  const safePath = normalizeEditableWorkspacePath(path);
  if (content.length > 200_000) throw new Error('file content is too large');
  const sandbox = getSessionSandbox(env, sessionId) as SandboxFileApi;
  await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxFileWrite,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: 'file_write',
    },
    async () => {
      await sandbox.writeFile(safePath, content);
    }
  );
  return {path: safePath, byteLength: new TextEncoder().encode(content).length};
}

export async function injectFault(
  env: Bindings,
  sessionId: string,
  type: string,
  params: Record<string, unknown>
) {
  const sandbox = getSessionSandbox(env, sessionId);
  await withSandboxExecSpan(env, sessionId, 'fault_inject', async () => {
    await sandbox.exec(buildFaultCommand(type, params));
  });
}

export async function evaluateSuccessCondition(
  env: Bindings,
  sessionId: string,
  condition: SuccessCondition
) {
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'success_check',
    async () => await sandbox.exec(buildSuccessCheckCommand(condition))
  );
  return result.success;
}

function parseMetricsSnapshot(
  payload: Record<string, unknown>
): MetricsSnapshot | null {
  const numbers = [
    'cpu',
    'memory',
    'disk',
    'http5xxRate',
    'latencyP95Ms',
    'rps',
    'dbConnections',
    'queueDepth',
  ] as const;
  for (const key of numbers) {
    if (typeof payload[key] !== 'number' || !Number.isFinite(payload[key])) {
      return null;
    }
  }
  return {
    at: typeof payload.at === 'number' ? payload.at : Date.now(),
    cpu: payload.cpu as number,
    memory: payload.memory as number,
    disk: payload.disk as number,
    http5xxRate: payload.http5xxRate as number,
    latencyP95Ms: payload.latencyP95Ms as number,
    rps: payload.rps as number,
    dbConnections: payload.dbConnections as number,
    queueDepth: payload.queueDepth as number,
  };
}

function compactSandboxExecFailure(
  result: {success?: boolean; stdout?: string; stderr?: string},
  error?: unknown
) {
  const details = [
    `success=${String(result.success)}`,
    result.stderr?.trim()
      ? `stderr=${truncateLogField(result.stderr)}`
      : undefined,
    result.stdout?.trim()
      ? `stdout=${truncateLogField(result.stdout)}`
      : undefined,
    error instanceof Error
      ? `error=${error.message}`
      : error !== undefined
        ? `error=${formatUnknown(error)}`
        : undefined,
  ].filter(Boolean);
  return details.join(' ');
}

function truncateLogField(value: string) {
  const compact = value.trim().replace(/\s+/g, ' ');
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

async function isSandboxPrepared(
  sandbox: SandboxRuntime,
  scenarioId: string
): Promise<boolean> {
  try {
    const result = await sandbox.exec(
      `if [ -f ${shellArg(SANDBOX_PREPARED_MARKER)} ]; then cat ${shellArg(
        SANDBOX_PREPARED_MARKER
      )}; fi`,
      {cwd: '/workspace'}
    );
    if (!result.success || !result.stdout.trim()) return false;
    const marker = JSON.parse(result.stdout) as {scenarioId?: unknown};
    return marker.scenarioId === scenarioId;
  } catch {
    return false;
  }
}

export async function destroySessionSandbox(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  try {
    await sandbox.killAllProcesses();
  } catch {
    // best effort
  }
  try {
    await (sandbox as SandboxRuntime & {destroy(): Promise<void>}).destroy();
  } catch {
    // best effort
  }
}

function sessionSandboxName(sessionId: string) {
  return `session-${sessionId}`;
}

async function withSandboxExecSpan<T>(
  env: Bindings,
  sessionId: string,
  commandKind: string,
  run: () => T | Promise<T>,
  processId?: string
): Promise<T> {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxExec,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: commandKind,
      [INCIDENT_ATTRS.sandboxProcessId]: processId,
    },
    async () => await run()
  );
}
