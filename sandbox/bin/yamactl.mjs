#!/usr/bin/env node
import {execFile, spawn} from 'node:child_process';
import {appendFile, mkdir, open} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {pingDb} from '../services/yamabiko-api/server.mjs';

const execFileAsync = promisify(execFile);

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';
const SANDBOX_CONTROL_URL =
  process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:3000';
const PORT_WAIT_MS = 30_000;
const PORT_RELEASE_WAIT_MS = 3_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_200;
const USAGE = 'usage: yamactl <status|restart|stop> <api|fake-db|monitor-agent>';

export const SERVICES = {
  api: {
    processId: 'api',
    port: 8080,
    pattern: 'yamabiko-api/server.mjs',
    description: 'yamabiko-api (やまびこ API)',
    command: 'PORT=8080 node /workspace/services/yamabiko-api/server.mjs',
    scriptPath: 'services/yamabiko-api/server.mjs',
    env: {PORT: '8080'},
  },
  'fake-db': {
    processId: 'fake-db',
    port: 15432,
    pattern: 'fake-db/server.mjs',
    description: 'fake-db (疑似データベース)',
    command: 'node /workspace/services/fake-db/server.mjs',
    scriptPath: 'services/fake-db/server.mjs',
    env: {},
  },
  'monitor-agent': {
    processId: 'monitor-agent',
    // no TCP port: this is a background sampler, not an HTTP service, so
    // status/restart are driven by a plain process probe instead.
    port: undefined,
    pattern: 'monitor-agent/agent.mjs',
    description: 'monitor-agent (監視エージェント)',
    command: 'node /workspace/services/monitor-agent/agent.mjs',
    scriptPath: 'services/monitor-agent/agent.mjs',
    env: {},
  },
};

export async function runYamactl(command, serviceName, options = {}) {
  const service = SERVICES[serviceName];
  if (!['status', 'restart', 'stop'].includes(command) || !service) {
    throw usageError();
  }

  const deps = buildDeps(options);
  if (command === 'status') return await statusService(service, deps);
  if (command === 'restart') return await restartService(service, deps);
  return await stopService(service, deps);
}

function buildDeps(options) {
  return {
    workspace: options.workspace ?? DEFAULT_WORKSPACE,
    port: options.port,
    controlPlaneUrl: options.controlPlaneUrl ?? SANDBOX_CONTROL_URL,
    findPids: options.findPids ?? findPidsByPattern,
    killProcess: options.killProcess ?? killByPattern,
    spawnProcess: options.spawnProcess,
    manageProcess: options.manageProcess ?? true,
  };
}

async function statusService(service, deps) {
  const port = deps.port ?? service.port;
  const pids = await deps.findPids(service.pattern);

  if (port === undefined) {
    const lines = [`● ${service.processId} - ${service.description}`];
    if (pids.length > 0) {
      lines.push(`   Process: running (pid ${pids.join(', ')})`);
      lines.push('   Health:  process alive');
    } else {
      lines.push('   Process: dead');
      lines.push('   Health:  unreachable');
      lines.push(
        `   Hint:    not running. start with: yamactl restart ${service.processId}`
      );
    }
    return lines.join('\n');
  }

  const portOpen = await canConnect(port);
  const probe = portOpen ? await probeService(service, port) : {ok: false};

  const lines = [`● ${service.processId} - ${service.description}`];
  lines.push(
    pids.length > 0
      ? `   Process: running (pid ${pids.join(', ')})`
      : '   Process: dead'
  );
  lines.push(`   Port:    ${String(port)} ${portOpen ? 'open' : 'closed'}`);

  if (!portOpen && pids.length === 0) {
    lines.push('   Health:  unreachable');
    lines.push(
      `   Hint:    not running. start with: yamactl restart ${service.processId}`
    );
  } else if (portOpen && probe.ok) {
    lines.push(`   Health:  ${probe.detail}`);
  } else if (portOpen && !probe.ok && probe.foreign) {
    lines.push(`   Health:  ${probe.detail}`);
    lines.push(
      `   Hint:    port ${String(port)} answers but it is NOT ${service.processId}. find the owner: ss -ltnp | grep ${String(port)}`
    );
  } else if (portOpen && !probe.ok) {
    lines.push(`   Health:  ${probe.detail}`);
  } else {
    lines.push(
      `   Health:  process alive but port ${String(port)} closed or not responding`
    );
    lines.push(
      '   Hint:    check process state: ps -o pid,stat,cmd -p ' +
        pids.join(',')
    );
  }
  return lines.join('\n');
}

async function probeService(service, port) {
  if (service.processId === 'api') {
    try {
      const startedAt = performance.now();
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`, {
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      });
      const elapsed = Math.round(performance.now() - startedAt);
      const payload = await response.json().catch(() => ({}));
      if (payload.service !== 'yamabiko-api') {
        return {
          ok: false,
          foreign: true,
          detail: `port answered but service identity is "${String(payload.service ?? 'unknown')}"`,
        };
      }
      if (response.status === 200) {
        return {ok: true, detail: `200 OK (${String(elapsed)}ms)`};
      }
      return {
        ok: false,
        detail: `${String(response.status)} ${payload.reason ?? 'degraded'}`,
      };
    } catch {
      return {
        ok: false,
        detail: `no response within ${String(HEALTH_PROBE_TIMEOUT_MS)}ms (process may be hung)`,
      };
    }
  }

  const ping = await pingDb({
    port,
    timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
    clientName: 'yamactl',
  });
  return ping.ok
    ? {ok: true, detail: 'ping/pong OK'}
    : {ok: false, detail: ping.reason};
}

async function restartService(service, deps) {
  const port = deps.port ?? service.port;
  await appendAppLog(
    deps.workspace,
    `${service.processId} restart requested by yamactl\n`
  );

  if (!deps.manageProcess) return `${service.processId} restarted`;

  await stopProcessHard(service, deps);

  if (port === undefined) {
    await waitForProcessState(deps, service.pattern, false, PORT_RELEASE_WAIT_MS);
    await startProcess(service, deps);
    if (
      !(await waitForProcessState(deps, service.pattern, true, PORT_WAIT_MS))
    ) {
      throw new Error(
        `${service.processId} start requested but the process did not appear. ` +
          `check /workspace/logs/${service.processId}.err.log`
      );
    }
    await appendAppLog(deps.workspace, `${service.processId} restarted\n`);
    return `${service.processId} restarted`;
  }

  const released = await waitForPortState(port, false, PORT_RELEASE_WAIT_MS);
  if (!released) {
    throw new Error(
      `restart aborted: port ${String(port)} is still in use by another process. ` +
        `find the owner with: ss -ltnp | grep ${String(port)}`
    );
  }

  await startProcess(service, deps);
  if (!(await waitForPortState(port, true, PORT_WAIT_MS))) {
    throw new Error(
      `${service.processId} start requested but port ${String(port)} did not open. ` +
        `check /workspace/logs/${service.processId}.err.log`
    );
  }

  const probe = await probeService(service, port);
  if (probe.foreign) {
    throw new Error(
      `restart failed: port ${String(port)} was taken by another process (${probe.detail}). ` +
        `find it with: ss -ltnp | grep ${String(port)}`
    );
  }
  await appendAppLog(deps.workspace, `${service.processId} restarted\n`);
  return `${service.processId} restarted`;
}

async function stopService(service, deps) {
  await appendAppLog(
    deps.workspace,
    `${service.processId} stopped by yamactl\n`
  );
  if (deps.manageProcess) {
    await stopProcessHard(service, deps);
  }
  return `${service.processId} stopped`;
}

async function stopProcessHard(service, deps) {
  try {
    const baseUrl = deps.controlPlaneUrl.replace(/\/$/, '');
    await fetch(`${baseUrl}/api/process/${service.processId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // control plane unavailable; fall through to signal-based kill
  }
  // SIGKILL also clears SIGSTOP-frozen (hung) processes
  await deps.killProcess(service.pattern, 'KILL');
}

async function startProcess(service, deps) {
  if (deps.spawnProcess) {
    await deps.spawnProcess(service);
    return;
  }
  if (await startViaControlPlane(service, deps)) return;
  await startViaDetachedSpawn(service, deps);
}

async function startViaControlPlane(service, deps) {
  const baseUrl = deps.controlPlaneUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/api/process/start`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        command: service.command,
        processId: service.processId,
        cwd: deps.workspace,
        autoCleanup: false,
        env: {...service.env, WORKSPACE_DIR: deps.workspace},
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.success !== false;
  } catch {
    return false;
  }
}

async function startViaDetachedSpawn(service, deps) {
  await mkdir(path.join(deps.workspace, 'logs'), {recursive: true});
  const stdout = await open(
    path.join(deps.workspace, 'logs', `${service.processId}.out.log`),
    'a'
  );
  const stderr = await open(
    path.join(deps.workspace, 'logs', `${service.processId}.err.log`),
    'a'
  );
  const child = spawn(
    'node',
    [path.join(deps.workspace, service.scriptPath)],
    {
      cwd: deps.workspace,
      detached: true,
      env: {...process.env, ...service.env, WORKSPACE_DIR: deps.workspace},
      stdio: ['ignore', stdout.fd, stderr.fd],
    }
  );
  child.unref();
  stdout.close().catch(() => {});
  stderr.close().catch(() => {});
}

async function findPidsByPattern(pattern) {
  try {
    const {stdout} = await execFileAsync('pgrep', ['-f', pattern]);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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

function usageError() {
  const error = new Error(USAGE);
  error.code = 'USAGE';
  return error;
}

async function appendAppLog(workspace, line) {
  await mkdir(path.join(workspace, 'logs'), {recursive: true});
  await appendFile(path.join(workspace, 'logs', 'app.log'), line);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPortState(port, wantOpen, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await canConnect(port)) === wantOpen) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await canConnect(port)) === wantOpen;
}

async function waitForProcessState(deps, pattern, wantPresent, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await deps.findPids(pattern);
    if ((pids.length > 0) === wantPresent) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const pids = await deps.findPids(pattern);
  return (pids.length > 0) === wantPresent;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [command, service] = process.argv.slice(2);
  try {
    process.stdout.write(`${await runYamactl(command, service)}\n`);
  } catch (error) {
    console.error(error.code === 'USAGE' ? USAGE : error.message);
    process.exit(1);
  }
}
