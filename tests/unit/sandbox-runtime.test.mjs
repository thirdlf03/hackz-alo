import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

import {runKodama} from '../../sandbox/bin/kodama.mjs';
import {
  injectFault,
  normalizeWorkspacePath,
} from '../../sandbox/bin/fault-injector.mjs';
import {runYamactl} from '../../sandbox/bin/yamactl.mjs';
import {
  createFakeDbServer,
  handleCommand,
} from '../../sandbox/services/fake-db/server.mjs';
import {startConnectionHog} from '../../sandbox/services/batch/report-batch.mjs';
import {createLegacyMetricsAgent} from '../../sandbox/services/tools/legacy-metrics-agent.mjs';
import {
  apiConfigPath,
  previousReleasePath,
  readApiConfig,
} from '../../sandbox/services/yamabiko-api/config.mjs';
import {
  createYamabikoApiServer,
  getHealth,
  getMetrics,
  pingDb,
  prepareWorkspace,
} from '../../sandbox/services/yamabiko-api/server.mjs';
import {
  appendTrafficSample,
  RequestMetricsTracker,
  readLogVolume,
  readSystemMetrics,
  readTrafficMetrics,
} from '../../sandbox/services/metrics/collector.mjs';
import {
  agentFilePath,
  monitoringConfigPath,
  sampleOnce,
  startMonitorAgent,
} from '../../sandbox/services/monitor-agent/agent.mjs';
import {floodOnce} from '../../sandbox/services/tools/alert-flood-daemon.mjs';

const execFileAsync = promisify(execFile);

test('kodama evaluates valid programs and reports structured runtime errors', () => {
  assert.equal(
    runKodama(
      'やまびこ帳 sample\nよぶ x = 8\nよぶ y = 3\nかえす ( x たす y ) かける 2\n'
    ),
    22
  );

  assert.throws(
    () =>
      runKodama('よぶ x = 100\nよぶ y = しずか\nよぶ z = x わる y\nかえす z\n'),
    (error) => {
      assert.equal(error.message, 'こだまが返ってきません');
      assert.equal(error.code, 'DIVISION_BY_ZERO');
      assert.equal(error.line, 3);
      assert.equal(error.column, 1);
      return true;
    }
  );
});

test('fault injector kills real processes and leaves narrative evidence', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const kills = [];
  const killProcess = async (pattern, signal) => {
    kills.push({pattern, signal});
  };

  assert.match(
    await injectFault('process_stop', ['api'], {workspace, killProcess}),
    /process_stop injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'yamabiko-api/server.mjs',
    signal: 'KILL',
  });
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /supervisor: api process exited unexpectedly/
  );

  assert.match(
    await injectFault('process_hang', ['api'], {workspace, killProcess}),
    /process_hang injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'yamabiko-api/server.mjs',
    signal: 'STOP',
  });
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /event loop blocked/
  );

  assert.match(
    await injectFault('janitor_power_pull', [], {workspace, killProcess}),
    /janitor_power_pull injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'yamabiko-api/server.mjs',
    signal: 'KILL',
  });
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /power loss on rack B\? janitor was seen unplugging things/
  );

  assert.match(
    await injectFault('cable_jumprope', [], {workspace, killProcess}),
    /cable_jumprope injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'fake-db/server.mjs',
    signal: 'KILL',
  });
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /jump-rope contest/
  );

  assert.match(
    await injectFault('runbook_gaslight', ['気合い'], {workspace}),
    /runbook_gaslight injected/
  );
  const gaslightedRunbook = await readFile(
    path.join(workspace, 'docs', 'runbooks', 'service-recovery.md'),
    'utf8'
  );
  assert.match(gaslightedRunbook, /気合い/);
});

test('fault injector spawns real culprit processes for pool and port faults', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const kills = [];
  const spawns = [];
  const killProcess = async (pattern, signal) => {
    kills.push({pattern, signal});
  };
  const spawnProcess = async (spec) => {
    spawns.push(spec);
  };

  assert.match(
    await injectFault('db_pool_exhaust', ['12'], {
      workspace,
      killProcess,
      spawnProcess,
    }),
    /db_pool_exhaust injected \(report-batch holding 12\)/
  );
  assert.equal(spawns.at(-1).script, 'services/batch/report-batch.mjs');
  assert.deepEqual(spawns.at(-1).args, ['12']);

  assert.match(
    await injectFault('port_conflict', ['8080'], {
      workspace,
      killProcess,
      spawnProcess,
    }),
    /port_conflict injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'yamabiko-api/server.mjs',
    signal: 'KILL',
  });
  assert.equal(spawns.at(-1).script, 'services/tools/legacy-metrics-agent.mjs');
  assert.equal(spawns.at(-1).env.PORT, '8080');

  assert.match(
    await injectFault('alert_spam', ['6'], {
      workspace,
      killProcess,
      spawnProcess,
    }),
    /alert_spam injected \(daemon spawned, burst 6\)/
  );
  assert.equal(spawns.at(-1).script, 'services/tools/alert-flood-daemon.mjs');
  assert.deepEqual(spawns.at(-1).args, ['6']);

  assert.match(
    await injectFault('runaway_loadgen', [], {
      workspace,
      killProcess,
      spawnProcess,
    }),
    /runaway_loadgen injected/
  );
  assert.equal(spawns.at(-1).script, 'services/tools/loadgen.mjs');
  assert.deepEqual(spawns.at(-1).args, ['http://127.0.0.1:8080/orders']);

  assert.match(
    await injectFault('monitor_blind', [], {
      workspace,
      killProcess,
      spawnProcess,
    }),
    /monitor_blind injected/
  );
  assert.deepEqual(kills.at(-1), {
    pattern: 'monitor-agent/agent.mjs',
    signal: 'KILL',
  });
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /monitor-agent process exited unexpectedly/
  );
});

test('connection hog holds exactly the requested number of connections', async (t) => {
  const workspace = await tempWorkspace();
  const db = createFakeDbServer({workspace, maxConnections: 100});
  const address = await listenTcp(db);
  const hog = startConnectionHog({target: 5, port: address.port});
  t.after(async () => {
    hog.stop();
    await closeServer(db);
    await rm(workspace, {recursive: true, force: true});
  });

  await waitFor(async () => (await readStats(workspace)).connections === 5);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(hog.size(), 5);
  assert.equal((await readStats(workspace)).connections, 5);
});

test('bad deploy breaks the real config and rollback restores health', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const db = createFakeDbServer({workspace});
  const dbAddress = await listenTcp(db);
  t.after(() => closeServer(db));
  await prepareWorkspace(workspace);
  await writeConfig(workspace, {dbPort: dbAddress.port});

  assert.equal((await getHealth(workspace)).ok, true);

  await injectFault('bad_deploy', [], {workspace});
  const brokenConfig = await readApiConfig(workspace);
  assert.equal(brokenConfig.config.dbPort, 5432);
  assert.equal(brokenConfig.config.version, 'v42');
  assert.match(
    await readFile(path.join(workspace, 'logs', 'deploy.log'), 'utf8'),
    /deploy v42/
  );

  const broken = await getHealth(workspace);
  assert.equal(broken.ok, false);
  assert.match(broken.reason, /^db: connect/);
  // the failure leaves an evidence trail in app.log
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /health check failed: db: connect/
  );

  // rollback = restore the previous release file
  await writeFile(
    apiConfigPath(workspace),
    await readFile(previousReleasePath(workspace), 'utf8')
  );
  assert.equal((await getHealth(workspace)).ok, true);
});

test('dns misconfig points the api at an unresolvable db host', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);

  await injectFault('dns_misconfig', [], {workspace});
  const config = await readApiConfig(workspace);
  assert.equal(config.config.dbHost, 'db01.yamabiko.internal');

  const health = await getHealth(workspace);
  assert.equal(health.ok, false);
  assert.match(health.reason, /^db: connect/);
});

test('getHealth reflects real db state, config validity, and log quota', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const db = createFakeDbServer({workspace, maxConnections: 2});
  const dbAddress = await listenTcp(db);
  await prepareWorkspace(workspace);
  await writeConfig(workspace, {dbPort: dbAddress.port});

  const healthy = await getHealth(workspace);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.service, 'yamabiko-api');

  // pool saturation: two held connections exhaust maxConnections=2
  const hog = startConnectionHog({
    target: 2,
    host: '127.0.0.1',
    port: dbAddress.port,
  });
  await waitFor(async () => hog.size() === 2);
  const saturated = await getHealth(workspace);
  assert.equal(saturated.ok, false);
  assert.match(saturated.reason, /too many connections/);
  hog.stop();
  await waitFor(async () => (await getHealth(workspace)).ok);

  // db down: connection genuinely refused
  await closeServer(db);
  const dbDown = await getHealth(workspace);
  assert.equal(dbDown.ok, false);
  assert.match(dbDown.reason, /db: connect (ECONNREFUSED|ETIMEDOUT)/);

  // invalid config: the app cannot parse its own config file
  await writeFile(apiConfigPath(workspace), '{broken json');
  const badConfig = await getHealth(workspace);
  assert.equal(badConfig.ok, false);
  assert.match(badConfig.reason, /^config:/);
});

test('log volume quota degrades health and recovers after cleanup', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const db = createFakeDbServer({workspace});
  const dbAddress = await listenTcp(db);
  t.after(() => closeServer(db));
  await prepareWorkspace(workspace);
  await writeConfig(workspace, {
    dbPort: dbAddress.port,
    logQuotaBytes: 100 * 1024,
  });

  await injectFault('disk_full', ['logs/debug.log', String(95 * 1024)], {
    workspace,
  });
  const pressured = await getHealth(workspace);
  assert.equal(pressured.ok, false);
  assert.match(pressured.reason, /^logs: volume at/);

  const volume = await readLogVolume(workspace, 100 * 1024);
  assert.ok(volume.percent >= 90);

  await rm(path.join(workspace, 'logs', 'debug.log'));
  assert.equal((await getHealth(workspace)).ok, true);
});

test('fault injector keeps targets inside the workspace and writes exact byte counts', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  await injectFault('disk_full', ['logs/debug.log', '1500'], {workspace});
  assert.equal(
    (await stat(path.join(workspace, 'logs', 'debug.log'))).size,
    1500
  );

  await injectFault('disk_full', ['logs/debug.log', '7'], {workspace});
  assert.equal(
    (await stat(path.join(workspace, 'logs', 'debug.log'))).size,
    1507
  );

  assert.equal(
    normalizeWorkspacePath('logs/debug.log', workspace),
    path.join(workspace, 'logs', 'debug.log')
  );
  assert.throws(
    () => normalizeWorkspacePath(`${workspace}-escape/debug.log`, workspace),
    /inside workspace/
  );
  await assert.rejects(
    () => injectFault('disk_full', ['../escape.log', '1'], {workspace}),
    /inside workspace/
  );
});

test('kodama batch failure can embed spec in やまびこ帳 comments', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  const target = path.join(workspace, 'services', 'batch', 'sales.kdm');
  await injectFault(
    'kodama_batch_failure',
    [target, 'sales-nightly', 'spec-in-comments'],
    {workspace}
  );
  const source = await readFile(target, 'utf8');
  assert.match(source, /やまびこ帳 わる=割り算/);
  assert.match(source, /よぶ y = しずか/);
  assert.match(
    await readFile(path.join(workspace, 'logs', 'batch.log'), 'utf8'),
    /sales-nightly: こだまが返ってきません/
  );
});

test('yamactl status reports dead, healthy, and hijacked ports', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const db = createFakeDbServer({workspace});
  const dbAddress = await listenTcp(db);
  t.after(() => closeServer(db));
  await prepareWorkspace(workspace);
  await writeConfig(workspace, {dbPort: dbAddress.port});

  // dead: nothing on the port, no process
  const freePort = await findFreePort();
  const dead = await runYamactl('status', 'api', {
    workspace,
    port: freePort,
    findPids: async () => [],
    manageProcess: false,
  });
  assert.match(dead, /Process: dead/);
  assert.match(dead, /not running/);

  // healthy: a real yamabiko-api answering on the port
  const api = createYamabikoApiServer({workspace});
  const apiAddress = await listenTcp(api);
  t.after(() => closeServer(api));
  const healthy = await runYamactl('status', 'api', {
    workspace,
    port: apiAddress.port,
    findPids: async () => ['4242'],
    manageProcess: false,
  });
  assert.match(healthy, /Process: running \(pid 4242\)/);
  assert.match(healthy, /200 OK/);

  // hijacked: the port answers but it is not yamabiko-api
  const squatter = createLegacyMetricsAgent();
  const squatterAddress = await listenTcp(squatter);
  t.after(() => closeServer(squatter));
  const hijacked = await runYamactl('status', 'api', {
    workspace,
    port: squatterAddress.port,
    findPids: async () => [],
    manageProcess: false,
  });
  assert.match(hijacked, /legacy-metrics-agent/);
  assert.match(hijacked, /ss -ltnp/);

  await assert.rejects(
    () => runYamactl('status', 'db', {workspace}),
    /usage: yamactl/
  );
});

test('yamactl restart aborts with a hint when the port is squatted', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  const squatter = createLegacyMetricsAgent();
  const squatterAddress = await listenTcp(squatter);
  t.after(() => closeServer(squatter));

  await assert.rejects(
    () =>
      runYamactl('restart', 'api', {
        workspace,
        port: squatterAddress.port,
        killProcess: async () => {},
        findPids: async () => [],
      }),
    /still in use by another process[\s\S]*ss -ltnp/
  );
});

test('yamactl stop kills the real process and logs the action', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const kills = [];

  const result = await runYamactl('stop', 'api', {
    workspace,
    killProcess: async (pattern, signal) => {
      kills.push({pattern, signal});
    },
    controlPlaneUrl: 'http://127.0.0.1:1',
  });
  assert.equal(result, 'api stopped');
  assert.deepEqual(kills, [
    {pattern: 'yamabiko-api/server.mjs', signal: 'KILL'},
  ]);
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /api stopped by yamactl/
  );
});

test('yamactl CLI reports status for both managed services', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  const script = fileURLToPath(
    new URL('../../sandbox/bin/yamactl.mjs', import.meta.url)
  );
  const result = await execFileAsync('node', [script, 'status', 'fake-db'], {
    env: {...process.env, WORKSPACE_DIR: workspace},
  });
  assert.match(result.stdout, /● fake-db - fake-db/);
  assert.equal(result.stderr, '');
});

test('yamabiko-api serves real health, metrics, and access log evidence', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const db = createFakeDbServer({workspace});
  const dbAddress = await listenTcp(db);
  await prepareWorkspace(workspace);
  await writeConfig(workspace, {dbPort: dbAddress.port});

  const server = createYamabikoApiServer({workspace});
  const baseUrl = await listenHttp(server);
  t.after(() => closeServer(server));

  let response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'yamabiko-api');

  response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);

  // dependency failure is real: stop the db and the api starts failing
  await closeServer(db);
  response = await fetch(`${baseUrl}/orders`);
  assert.equal(response.status, 500);
  const orders = await response.json();
  assert.match(orders.error, /^db: connect/);

  response = await fetch(`${baseUrl}/metrics`);
  assert.equal(response.status, 200);
  const metrics = await response.json();
  assert.equal(metrics.http5xxRate, 1 / 3);
  assert.equal(typeof metrics.cpu, 'number');
  assert.equal(typeof metrics.disk, 'number');

  const accessLog = await readFile(
    path.join(workspace, 'logs', 'access.log'),
    'utf8'
  );
  assert.match(accessLog, /GET \/health 200/);
  assert.match(accessLog, /GET \/missing 404/);
  assert.match(accessLog, /GET \/orders 500/);
});

test('readTrafficMetrics reports 5xx when upstream api process is stopped', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);

  const metrics = await readTrafficMetrics(workspace);
  assert.ok(metrics.http5xxRate >= 0.5);
  assert.ok(metrics.latencyP95Ms >= 0);
});

test('metrics exporter emits a complete snapshot outside the api process', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);
  for (let index = 0; index < 60; index += 1) {
    await appendTrafficSample(workspace, 500, 25);
  }

  const script = fileURLToPath(
    new URL('../../sandbox/services/metrics/export.mjs', import.meta.url)
  );
  const result = await execFileAsync('node', [script], {
    env: {...process.env, WORKSPACE_DIR: workspace},
  });

  assert.equal(result.stderr, '');
  const metrics = JSON.parse(result.stdout);
  assert.equal(typeof metrics.at, 'number');
  assert.equal(typeof metrics.cpu, 'number');
  assert.equal(typeof metrics.memory, 'number');
  assert.equal(typeof metrics.disk, 'number');
  assert.ok(metrics.http5xxRate > 0);
  assert.ok(metrics.rps > 0);
  assert.equal(metrics.dbConnections, 0);
  assert.equal(metrics.queueDepth, 0);
});

test('getMetrics uses request tracker and service state files', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);
  await mkdir(path.join(workspace, 'run'), {recursive: true});
  await writeFile(
    path.join(workspace, 'run', 'job-queue.jsonl'),
    '{"id":"job-001","status":"pending"}\n{"id":"job-002","status":"pending"}\n'
  );
  await writeFile(
    path.join(workspace, 'run', 'fake-db-stats.json'),
    '{"connections":3}\n'
  );

  const tracker = new RequestMetricsTracker();
  tracker.record(200, 40);
  tracker.record(500, 120);
  tracker.record(500, 180);

  const metrics = await getMetrics(workspace, tracker);
  assert.equal(metrics.queueDepth, 2);
  assert.equal(metrics.dbConnections, 3);
  assert.equal(metrics.http5xxRate, 2 / 3);
  assert.equal(metrics.latencyP95Ms, 180);
});

test('readSystemMetrics reads CPU/memory directly by default (source: direct)', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  const metrics = await readSystemMetrics(workspace);
  assert.equal(typeof metrics.cpu, 'number');
  assert.equal(typeof metrics.memory, 'number');
  assert.equal(typeof metrics.disk, 'number');
});

test('monitor-agent switches the workspace to agent-sourced metrics, and killing it goes blind', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  await sampleOnce(workspace);
  // sampleOnce alone (no agent started) must not flip the monitoring source
  assert.equal(existsSync(monitoringConfigPath(workspace)), false);

  const stopAgent = await startMonitorAgent(workspace);
  t.after(() => stopAgent());

  const config = JSON.parse(
    await readFile(monitoringConfigPath(workspace), 'utf8')
  );
  assert.equal(config.source, 'agent');

  const agentPayload = JSON.parse(
    await readFile(agentFilePath(workspace), 'utf8')
  );
  assert.equal(typeof agentPayload.cpu, 'number');
  assert.equal(typeof agentPayload.memory, 'number');
  assert.equal(typeof agentPayload.at, 'number');

  const live = await readSystemMetrics(workspace);
  assert.equal(typeof live.cpu, 'number');
  assert.equal(typeof live.memory, 'number');

  // simulate monitor_blind: the agent process is gone, so its data goes stale
  stopAgent();
  await writeFile(
    agentFilePath(workspace),
    JSON.stringify({cpu: 10, memory: 10, at: Date.now() - 60_000})
  );
  const blind = await readSystemMetrics(workspace);
  assert.equal(blind.cpu, null);
  assert.equal(blind.memory, null);
});

test('alert-flood-daemon appends noise alert bursts to app.log', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  await floodOnce(workspace, 3, 0);
  const log = await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8');
  const lines = log.split('\n').filter(Boolean);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /^noise alert: \[(CRITICAL|WARN)\]/);
  }
});

test('fake-db answers queries, tracks clients, and rejects beyond max connections', async (t) => {
  assert.equal(handleCommand('PING'), 'pong\n');
  assert.equal(handleCommand('select 1;'), 'row 1\n');

  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const server = createFakeDbServer({workspace, maxConnections: 2});
  const address = await listenTcp(server);
  t.after(() => closeServer(server));

  const first = await connectClient(address, 'app report-batch\n');
  const second = await connectClient(address, 'app report-batch\n');
  await waitFor(async () => {
    const stats = await readStats(workspace);
    return stats.connections === 2;
  });

  // third connection is genuinely rejected, like a saturated pool
  const rejection = await connectAndCollect(address, 'ping\n');
  assert.match(rejection, /too many connections/);

  await waitFor(async () => {
    const stats = await readStats(workspace);
    return stats.maxConnections === 2 && stats.rejectedTotal >= 1;
  });
  const stats = await readStats(workspace);
  assert.equal(stats.maxConnections, 2);
  assert.equal(stats.clients['report-batch'], 2);
  assert.ok(stats.rejectedTotal >= 1);

  // pingDb sees the saturation the same way the api does
  const saturated = await pingDb({port: address.port, timeoutMs: 500});
  assert.equal(saturated.ok, false);
  assert.match(saturated.reason, /too many connections/);

  first.destroy();
  second.destroy();
  await waitFor(async () => (await readStats(workspace)).connections === 0);

  const recovered = await pingDb({port: address.port, timeoutMs: 500});
  assert.equal(recovered.ok, true);
});

test('pingDb reports refused connections against closed ports', async () => {
  const port = await findFreePort();
  const result = await pingDb({port, timeoutMs: 300});
  assert.equal(result.ok, false);
  assert.match(result.reason, /connect ECONNREFUSED/);
});

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'incident-sandbox-'));
}

async function writeConfig(workspace, overrides) {
  const current = await readApiConfig(workspace);
  await writeFile(
    apiConfigPath(workspace),
    `${JSON.stringify({...current.config, ...overrides}, null, 2)}\n`
  );
}

async function readStats(workspace) {
  try {
    return JSON.parse(
      await readFile(path.join(workspace, 'run', 'fake-db-stats.json'), 'utf8')
    );
  } catch {
    return {connections: -1};
  }
}

async function connectClient(address, greeting) {
  const socket = net.createConnection(address);
  socket.setEncoding('utf8');
  await once(socket, 'connect');
  socket.write(greeting);
  socket.on('error', () => {});
  return socket;
}

async function connectAndCollect(address, message) {
  const socket = net.createConnection(address);
  socket.setEncoding('utf8');
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write(message);
  await once(socket, 'end');
  socket.destroy();
  return chunks.join('');
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('waitFor timed out');
}

async function findFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listenHttp(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

async function listenTcp(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {host: address.address, port: address.port};
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  });
}
