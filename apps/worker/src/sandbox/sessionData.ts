import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import {formatUnknown, type MetricsSnapshot} from '@incident/shared';
import type {Bindings} from '../types.js';
import {
  isWorkspacePath,
  normalizeEditableWorkspacePath,
  shellArg,
} from './pathSafety.js';
import {
  clampSessionLogTail,
  isAllowedSessionLogFile,
} from '../pure/sessionLogPolicy.js';
import {
  getSessionSandbox,
  type SandboxRuntime,
  withSandboxExecSpan,
} from './sessionSandbox.js';

export interface EditableFileEntry {
  path: string;
  size: number;
}

export type SandboxFileApi = SandboxRuntime & {
  readFile(path: string): Promise<{content: string} | string>;
  writeFile(path: string, content: string): Promise<unknown>;
};

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
  if (!isAllowedSessionLogFile(file)) return [];
  const path = `/workspace/logs/${file}.log`;
  const lines = clampSessionLogTail(tail);
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
    "if(fs.existsSync('/workspace/etc/yamabiko-api.json')) entries.push({key:'yamabiko-api.config',value:fs.readFileSync('/workspace/etc/yamabiko-api.json','utf8').trim()});",
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
