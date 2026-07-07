import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
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
import {
  createYamabikoApiServer,
  getHealth,
  getMetrics,
  prepareWorkspace,
} from '../../sandbox/services/yamabiko-api/server.mjs';
import {
  appendTrafficSample,
  RequestMetricsTracker,
  readTrafficMetrics,
} from '../../sandbox/services/metrics/collector.mjs';

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

test('fault injector writes silly phase-2 markers', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  assert.match(
    await injectFault('janitor_power_pull', [], {workspace}),
    /janitor_power_pull injected/
  );
  assert.match(
    await readFile(path.join(workspace, 'run', 'janitor.power.pulled'), 'utf8'),
    /"culprit":"janitor"/
  );
  assert.match(
    await readFile(path.join(workspace, 'run', 'api.down'), 'utf8'),
    /^\d{4}-\d{2}-\d{2}T/
  );

  assert.match(
    await injectFault('cable_jumprope', [], {workspace}),
    /cable_jumprope injected/
  );
  assert.match(
    await readFile(path.join(workspace, 'run', 'network.jumprope'), 'utf8'),
    /"sport":"jumprope"/
  );
  assert.match(
    await readFile(path.join(workspace, 'run', 'hosts.override'), 'utf8'),
    /localhost-broken/
  );

  assert.match(
    await injectFault('keyboard_spill', ['sticky-keys'], {workspace}),
    /keyboard_spill injected/
  );
  assert.match(
    await readFile(path.join(workspace, 'run', 'keyboard.spill'), 'utf8'),
    /sticky-keys/
  );
  assert.equal(
    await readFile(path.join(workspace, 'run', 'terminal.noise'), 'utf8'),
    'sticky-keys'.repeat(3)
  );

  assert.match(
    await injectFault('alert_spam', ['6'], {workspace}),
    /alert_spam injected \(6\)/
  );
  const spam = JSON.parse(
    await readFile(path.join(workspace, 'run', 'alert.spam.json'), 'utf8')
  );
  assert.equal(spam.count, 6);
  assert.equal(spam.alerts.length, 6);

  assert.match(
    await injectFault('runbook_gaslight', ['気合い'], {workspace}),
    /runbook_gaslight injected/
  );
  const gaslight = JSON.parse(
    await readFile(path.join(workspace, 'run', 'runbook.gaslight.json'), 'utf8')
  );
  assert.equal(gaslight.replacement, '気合い');
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

test('yamactl creates run state and reports api status transitions', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  assert.equal(await runYamactl('status', 'api', {workspace}), 'api running');
  assert.equal(await runYamactl('stop', 'api', {workspace}), 'api stopped');
  assert.match(
    await readFile(path.join(workspace, 'run', 'api.down'), 'utf8'),
    /^\d{4}-\d{2}-\d{2}T/
  );
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /api stopped by yamactl/
  );
  assert.equal(await runYamactl('status', 'api', {workspace}), 'api stopped');
  assert.equal(
    await runYamactl('restart', 'api', {workspace}),
    'api restarted'
  );
  assert.equal(await runYamactl('status', 'api', {workspace}), 'api running');
  assert.match(
    await readFile(path.join(workspace, 'logs', 'app.log'), 'utf8'),
    /api restarted by yamactl/
  );

  await assert.rejects(
    () => runYamactl('status', 'db', {workspace}),
    /usage: yamactl/
  );
});

test('yamactl restart clears api.down but scenario markers still degrade health', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  await injectFault('janitor_power_pull', [], {workspace});
  assert.equal(
    await runYamactl('restart', 'api', {workspace}),
    'api restarted'
  );
  assert.match(
    await runYamactl('status', 'api', {workspace}),
    /api degraded \(janitor power pull marker active\)/
  );
  assert.equal((await getHealth(workspace)).ok, false);
});

test('bad deploy fails health until deploy.json is removed', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  await injectFault('bad_deploy', [], {workspace});
  assert.equal((await getHealth(workspace)).ok, false);
  assert.match((await getHealth(workspace)).reason, /bad deploy/);
  await rm(path.join(workspace, 'run', 'deploy.json'));
  assert.equal((await getHealth(workspace)).ok, true);
});

test('yamactl CLI writes command results to stdout', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));

  const script = fileURLToPath(
    new URL('../../sandbox/bin/yamactl.mjs', import.meta.url)
  );
  const result = await execFileAsync('node', [script, 'status', 'api'], {
    env: {...process.env, WORKSPACE_DIR: workspace},
  });

  assert.equal(result.stdout, 'api running\n');
  assert.equal(result.stderr, '');
});

test('yamabiko-api reflects marker health, metrics, and access log statuses', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);

  const server = createYamabikoApiServer({workspace});
  const baseUrl = await listenHttp(server);
  t.after(() => closeServer(server));

  let response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true});

  response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {error: 'not_found'});

  await mkdir(path.join(workspace, 'run'), {recursive: true});
  await writeFile(path.join(workspace, 'run', 'api.down'), '');

  response = await fetch(`${baseUrl}/orders`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'process marker says api is down',
  });

  response = await fetch(`${baseUrl}/metrics`);
  assert.equal(response.status, 200);
  const metrics = await response.json();
  assert.equal(metrics.http5xxRate, 1 / 3);
  assert.equal(typeof metrics.cpu, 'number');
  assert.equal(typeof metrics.memory, 'number');
  assert.equal(typeof metrics.disk, 'number');
  assert.equal(metrics.dbConnections, 0);
  assert.equal(metrics.queueDepth, 0);

  const accessLog = await readFile(
    path.join(workspace, 'logs', 'access.log'),
    'utf8'
  );
  assert.match(accessLog, /GET \/health 200/);
  assert.match(accessLog, /GET \/missing 404/);
  assert.match(accessLog, /GET \/orders 500/);
  assert.match(accessLog, /GET \/metrics 200/);
});

test('readTrafficMetrics reports 5xx when upstream api process is stopped', async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  await prepareWorkspace(workspace);

  const server = createYamabikoApiServer({workspace});
  const baseUrl = await listenHttp(server);

  const healthy = await fetch(`${baseUrl}/health`);
  assert.equal(healthy.status, 200);

  await closeServer(server);
  await injectFault('process_stop', ['api'], {workspace});

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

test('fake-db answers basic health and query commands', async (t) => {
  assert.equal(handleCommand('PING'), 'pong\n');
  assert.equal(handleCommand('select 1;'), 'row 1\n');

  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, {recursive: true, force: true}));
  const server = createFakeDbServer({workspace});
  const address = await listenTcp(server);
  t.after(() => closeServer(server));

  const socket = net.createConnection(address);
  socket.setEncoding('utf8');
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));

  await once(socket, 'connect');
  socket.write('ping\nselect 1;\nquit\n');
  await once(socket, 'end');

  assert.equal(chunks.join(''), 'fake-db ready\npong\nrow 1\nbye\n');
});

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'incident-sandbox-'));
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
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
