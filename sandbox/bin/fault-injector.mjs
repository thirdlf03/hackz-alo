#!/usr/bin/env node
import {execFile, spawn} from 'node:child_process';
import {appendFile, mkdir, open, readFile, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  apiConfigPath,
  previousReleasePath,
  readApiConfig,
} from '../services/yamabiko-api/config.mjs';

const execFileAsync = promisify(execFile);

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const USAGE =
  'usage: fault-injector.mjs process_stop|process_hang|port_conflict|disk_full|queue_backlog|kodama_batch_failure|bad_deploy|db_pool_exhaust|memory_leak|dns_misconfig|monitor_blind|composite_restart_loop|janitor_power_pull|cable_jumprope|keyboard_spill|alert_spam|runbook_gaslight';

const PROCESS_PATTERNS = {
  api: 'yamabiko-api/server.mjs',
  'fake-db': 'fake-db/server.mjs',
};

export async function injectFault(fault, args = [], options = {}) {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const killProcess = options.killProcess ?? killByPattern;
  const spawnProcess = options.spawnProcess ?? spawnDetached;

  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  await mkdir(path.join(workspace, 'run'), {recursive: true});

  if (fault === 'process_stop') {
    const processId = args[0] ?? 'api';
    const pattern = PROCESS_PATTERNS[processId];
    if (!pattern) throw new Error(`unsupported process ${processId}`);
    await killProcess(pattern, 'KILL');
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      `supervisor: ${processId} process exited unexpectedly (killed)\n`
    );
    return 'process_stop injected';
  }

  if (fault === 'process_hang') {
    const processId = args[0] ?? 'api';
    const pattern = PROCESS_PATTERNS[processId];
    if (!pattern) throw new Error(`unsupported process ${processId}`);
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'event loop blocked: gc pause 32108ms and climbing\n'
    );
    // SIGSTOP freezes the process: it stays alive (visible in ps as state T)
    // but stops answering — the classic down-vs-hang drill.
    await killProcess(pattern, 'STOP');
    return 'process_hang injected';
  }

  if (fault === 'port_conflict') {
    const port = String(parseByteCount(args[0] ?? 8080));
    await killProcess(PROCESS_PATTERNS.api, 'KILL');
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'supervisor: api process exited unexpectedly (killed)\n'
    );
    await spawnProcess({
      workspace,
      script: 'services/tools/legacy-metrics-agent.mjs',
      args: [],
      env: {PORT: port},
      logName: 'legacy-metrics-agent',
    });
    return 'port_conflict injected';
  }

  if (fault === 'disk_full') {
    const target = args[0] ?? path.join(workspace, 'logs', 'debug.log');
    const bytes = parseByteCount(args[1] ?? 64 * 1024 * 1024);
    const safeTarget = normalizeWorkspacePath(target, workspace);
    await mkdir(path.dirname(safeTarget), {recursive: true});
    await appendExactBytes(safeTarget, bytes);
    const totalBytes = (await stat(safeTarget)).size;
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      `debug log expanded to ${totalBytes} bytes\n`
    );
    return 'disk_full injected';
  }

  if (fault === 'queue_backlog') {
    const count = parseByteCount(args[0] ?? 32);
    const lines = Array.from({length: count}, (_, index) =>
      JSON.stringify({id: `backlog-${Date.now()}-${index}`, status: 'pending'})
    ).join('\n');
    await appendFile(
      path.join(workspace, 'run', 'job-queue.jsonl'),
      `${lines}\n`
    );
    return `queue_backlog injected (${count})`;
  }

  if (fault === 'kodama_batch_failure') {
    const target = normalizeWorkspacePath(
      args[0] ?? path.join(workspace, 'services', 'batch', 'sales.kdm'),
      workspace
    );
    const jobId = args[1] ?? 'sales-nightly';
    const specInComments = args[2] === 'spec-in-comments';
    await mkdir(path.dirname(target), {recursive: true});
    const brokenSource = specInComments
      ? 'やまびこ帳 売上集計バッチ\nやまびこ帳 わる=割り算。右辺がしずか(0)だとエラー\nやまびこ帳 しずか=0 / こだま=1。エラーは「こだまが返ってきません」のみ\nよぶ x = 100\nよぶ y = しずか\nよぶ z = x わる y\nかえす z\n'
      : 'やまびこ帳 売上集計バッチ\nよぶ x = 100\nよぶ y = しずか\nよぶ z = x わる y\nかえす z\n';
    await writeFile(target, brokenSource);
    await appendFile(
      path.join(workspace, 'logs', 'batch.log'),
      `${jobId}: こだまが返ってきません\n`
    );
    await appendFile(
      path.join(workspace, 'run', 'job-queue.jsonl'),
      `${JSON.stringify({id: jobId, status: 'failed'})}\n`
    );
    return 'kodama_batch_failure injected';
  }

  if (fault === 'bad_deploy') {
    // A real (broken) release: back up the running config, then roll out a
    // config pointing at the wrong DB port. The API genuinely starts failing
    // with ECONNREFUSED; rollback = restore the previous release file.
    const current = await readApiConfig(workspace);
    const base = current.ok ? current.config : {};
    await mkdir(path.dirname(previousReleasePath(workspace)), {
      recursive: true,
    });
    await mkdir(path.dirname(apiConfigPath(workspace)), {recursive: true});
    await writeFile(
      previousReleasePath(workspace),
      `${JSON.stringify(base, null, 2)}\n`
    );
    const broken = {
      ...base,
      version: 'v42',
      dbPort: 5432,
    };
    await writeFile(
      apiConfigPath(workspace),
      `${JSON.stringify(broken, null, 2)}\n`
    );
    const deployedAt = new Date().toISOString();
    await appendFile(
      path.join(workspace, 'logs', 'deploy.log'),
      `${deployedAt} deploy v42 started (config update: db settings)\n${deployedAt} deploy v42 finished in 4s\n`
    );
    return 'bad_deploy injected';
  }

  if (fault === 'db_pool_exhaust') {
    const connections = String(parseByteCount(args[0] ?? 40));
    await spawnProcess({
      workspace,
      script: 'services/batch/report-batch.mjs',
      args: [connections],
      env: {},
      logName: 'report-batch',
    });
    return `db_pool_exhaust injected (report-batch holding ${connections})`;
  }

  if (fault === 'memory_leak') {
    const targetPercent = parseByteCount(args[0] ?? 92);
    await writeFile(
      path.join(workspace, 'run', 'memory.leak'),
      String(targetPercent)
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      `memory leak simulated at ${targetPercent}%\n`
    );
    return 'memory_leak injected';
  }

  if (fault === 'dns_misconfig') {
    // Point the API at a hostname that does not resolve; the connection
    // attempt genuinely fails with a DNS error.
    const current = await readApiConfig(workspace);
    const base = current.ok ? current.config : {};
    await mkdir(path.dirname(previousReleasePath(workspace)), {
      recursive: true,
    });
    await mkdir(path.dirname(apiConfigPath(workspace)), {recursive: true});
    await writeFile(
      previousReleasePath(workspace),
      `${JSON.stringify(base, null, 2)}\n`
    );
    await writeFile(
      apiConfigPath(workspace),
      `${JSON.stringify({...base, dbHost: 'db01.yamabiko.internal'}, null, 2)}\n`
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'config reloaded: db host updated by night maintenance script\n'
    );
    return 'dns_misconfig injected';
  }

  if (fault === 'monitor_blind') {
    const blindMetrics = JSON.parse(args[0] ?? '["cpu","memory"]');
    await writeFile(
      path.join(workspace, 'run', 'monitor.blind.json'),
      JSON.stringify({blindMetrics})
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      `monitor blind: ${blindMetrics.join(',')}\n`
    );
    return 'monitor_blind injected';
  }

  if (fault === 'composite_restart_loop') {
    const diskPath = args[0] ?? path.join(workspace, 'logs', 'debug.log');
    const bytes = parseByteCount(args[1] ?? 64 * 1024 * 1024);
    const processId = args[2] ?? 'api';
    await injectFault('disk_full', [diskPath, String(bytes)], options);
    await injectFault('process_stop', [processId], options);
    return 'composite_restart_loop injected';
  }

  if (fault === 'janitor_power_pull') {
    const processId = args[0] ?? 'api';
    const pattern = PROCESS_PATTERNS[processId];
    if (!pattern) throw new Error(`unsupported process ${processId}`);
    const pulledAt = new Date().toISOString();
    await killProcess(pattern, 'KILL');
    await writeFile(
      path.join(workspace, 'run', 'janitor.power.pulled'),
      JSON.stringify({pulledAt, culprit: 'janitor', redundantSystems: false})
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'supervisor: api process exited unexpectedly (power loss on rack B?)\n'
    );
    return 'janitor_power_pull injected';
  }

  if (fault === 'cable_jumprope') {
    const processId = args[0] ?? 'fake-db';
    const pattern = PROCESS_PATTERNS[processId];
    if (!pattern) throw new Error(`unsupported process ${processId}`);
    const disconnectedAt = new Date().toISOString();
    await killProcess(pattern, 'KILL');
    await writeFile(
      path.join(workspace, 'run', 'network.jumprope'),
      JSON.stringify({
        sport: 'jumprope',
        cable: 'DBラック行きLANケーブル',
        witness: '休憩室カメラに縄跳び大会が写っていた',
        disconnectedAt,
      })
    );
    return 'cable_jumprope injected';
  }

  if (fault === 'keyboard_spill') {
    const noise = args[0] ?? 'べちゃっxべちゃっ';
    const spilledAt = new Date().toISOString();
    await writeFile(
      path.join(workspace, 'run', 'keyboard.spill'),
      JSON.stringify({beverage: 'fridge sake', noise, spilledAt})
    );
    await writeFile(
      path.join(workspace, 'run', 'terminal.noise'),
      noise.repeat(3)
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'keyboard spill detected on operator terminal\n'
    );
    return 'keyboard_spill injected';
  }

  if (fault === 'alert_spam') {
    const count = parseByteCount(args[0] ?? 24);
    const alerts = Array.from({length: count}, (_, index) => ({
      id: `spam-${Date.now()}-${index}`,
      severity: index % 3 === 0 ? 'critical' : 'warning',
      message:
        index % 2 === 0
          ? 'CPU fan is dancing'
          : 'Energy drink stock critically low',
    }));
    await writeFile(
      path.join(workspace, 'run', 'alert.spam.json'),
      JSON.stringify({count, alerts, injectedAt: new Date().toISOString()})
    );
    for (const alert of alerts.slice(0, 5)) {
      await appendFile(
        path.join(workspace, 'logs', 'app.log'),
        `noise alert: ${alert.message}\n`
      );
    }
    return `alert_spam injected (${count})`;
  }

  if (fault === 'runbook_gaslight') {
    const replacement = args[0] ?? '気合いで直す。根性。深呼吸。';
    await writeFile(
      path.join(workspace, 'run', 'runbook.gaslight.json'),
      JSON.stringify({
        replacement,
        gaslitAt: new Date().toISOString(),
        originalIntegrity: 'compromised',
      })
    );
    await appendFile(
      path.join(workspace, 'logs', 'app.log'),
      'runbook content replaced with unhelpful advice\n'
    );
    return 'runbook_gaslight injected';
  }

  throw usageError();
}

async function killByPattern(pattern, signal = 'TERM') {
  try {
    await execFileAsync('pkill', [`-${signal}`, '-f', pattern]);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 1
    )
      {return;}
    throw error;
  }
}

async function spawnDetached({workspace, script, args, env, logName}) {
  const scriptPath = path.join(workspace, script);
  if (!existsSync(scriptPath)) {
    throw new Error(`missing sandbox script: ${scriptPath}`);
  }
  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  const stdout = await open(
    path.join(workspace, 'logs', `${logName}.out.log`),
    'a'
  );
  const stderr = await open(
    path.join(workspace, 'logs', `${logName}.err.log`),
    'a'
  );
  const child = spawn('node', [scriptPath, ...args], {
    cwd: workspace,
    detached: true,
    env: {...process.env, ...env, WORKSPACE_DIR: workspace},
    stdio: ['ignore', stdout.fd, stderr.fd],
  });
  child.unref();
  stdout.close().catch(() => {});
  stderr.close().catch(() => {});
}

export function normalizeWorkspacePath(value, workspace = DEFAULT_WORKSPACE) {
  const root = path.resolve(workspace);
  const resolved = path.resolve(
    path.isAbsolute(value) ? value : path.join(root, value)
  );
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('target path must stay inside workspace');
  }
  return resolved;
}

async function appendExactBytes(file, bytes) {
  const chunk = Buffer.alloc(1024 * 1024, 'x');
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    await appendFile(
      file,
      size === chunk.length ? chunk : chunk.subarray(0, size)
    );
    remaining -= size;
  }
}

function parseByteCount(value) {
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error('byte count must be a non-negative integer');
  }
  return bytes;
}

function usageError() {
  const error = new Error(USAGE);
  error.code = 'USAGE';
  return error;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [fault, ...args] = process.argv.slice(2);
  try {
    console.log(await injectFault(fault, args));
  } catch (error) {
    console.error(error.code === 'USAGE' ? USAGE : error.message);
    process.exit(1);
  }
}
