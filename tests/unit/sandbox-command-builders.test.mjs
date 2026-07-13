import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {buildFaultCommand, faultCommandBuilders} = await tsImport(
  '../../apps/worker/src/sandbox/faultCommands.ts',
  import.meta.url
);
const {buildSuccessCheckCommand, successConditionBuilders} = await tsImport(
  '../../apps/worker/src/sandbox/successEvaluators.ts',
  import.meta.url
);
const {
  isWorkspacePath,
  normalizeEditableWorkspacePath,
  shellArg,
  shellPathSegment,
} = await tsImport(
  '../../apps/worker/src/sandbox/pathSafety.ts',
  import.meta.url
);

const faultInjector = 'node /workspace/bin/fault-injector.mjs';

test('buildFaultCommand covers every registered fault type', () => {
  const cases = [
    ['process_stop', {processId: 'api'}, `${faultInjector} process_stop 'api'`],
    ['process_hang', {processId: 'api'}, `${faultInjector} process_hang 'api'`],
    ['port_conflict', {port: 8080}, `${faultInjector} port_conflict 8080`],
    [
      'disk_full',
      {path: '/workspace/logs/debug.log', bytes: 1500},
      `${faultInjector} disk_full '/workspace/logs/debug.log' 1500`,
    ],
    [
      'kodama_batch_failure',
      {
        path: "/workspace/services/batch/sale's.kdm",
        jobId: 'sales-nightly',
        specInComments: true,
      },
      `${faultInjector} kodama_batch_failure '/workspace/services/batch/sale'"'"'s.kdm' 'sales-nightly' spec-in-comments`,
    ],
    ['queue_backlog', {count: 7}, `${faultInjector} queue_backlog 7`],
    ['bad_deploy', {}, `${faultInjector} bad_deploy`],
    [
      'db_pool_exhaust',
      {connections: 12},
      `${faultInjector} db_pool_exhaust 12`,
    ],
    ['dns_misconfig', {}, `${faultInjector} dns_misconfig`],
    [
      'monitor_blind',
      {blindMetrics: ['disk']},
      `${faultInjector} monitor_blind '["disk"]'`,
    ],
    [
      'composite_restart_loop',
      {diskPath: '/workspace/logs/debug.log', bytes: 2048, processId: 'api'},
      `${faultInjector} composite_restart_loop '/workspace/logs/debug.log' 2048 'api'`,
    ],
    [
      'janitor_power_pull',
      {processId: 'api'},
      `${faultInjector} janitor_power_pull 'api'`,
    ],
    [
      'cable_jumprope',
      {processId: 'fake-db'},
      `${faultInjector} cable_jumprope 'fake-db'`,
    ],
    [
      'runaway_loadgen',
      {targetUrl: 'http://127.0.0.1:8080/orders'},
      `${faultInjector} runaway_loadgen 'http://127.0.0.1:8080/orders'`,
    ],
    ['alert_spam', {count: 6}, `${faultInjector} alert_spam 6`],
    [
      'runbook_gaslight',
      {replacement: 'try rebooting'},
      `${faultInjector} runbook_gaslight 'try rebooting'`,
    ],
  ];

  assert.deepEqual(
    Object.keys(faultCommandBuilders).sort(),
    cases.map(([type]) => type).sort()
  );
  for (const [type, params, expected] of cases) {
    assert.equal(buildFaultCommand(type, params), expected);
  }
});

test('buildFaultCommand applies defaults and rejects unknown types', () => {
  assert.equal(
    buildFaultCommand('queue_backlog', {}),
    `${faultInjector} queue_backlog 32`
  );
  assert.equal(
    buildFaultCommand('monitor_blind', {}),
    `${faultInjector} monitor_blind '["cpu","memory"]'`
  );
  assert.equal(
    buildFaultCommand('runaway_loadgen', {}),
    `${faultInjector} runaway_loadgen`
  );
  assert.throws(
    () => buildFaultCommand('does_not_exist', {}),
    /unknown fault type: does_not_exist/
  );
});

test('buildSuccessCheckCommand covers every success condition type', () => {
  assert.deepEqual(Object.keys(successConditionBuilders).sort(), [
    'disk_usage_below',
    'http_status',
    'kodama_batch_ok',
    'log_absent',
    'process_absent',
    'process_running',
  ]);

  const httpScript =
    'fetch("http://127.0.0.1:8080/health",{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))';
  assert.equal(
    buildSuccessCheckCommand({
      type: 'http_status',
      url: 'http://127.0.0.1:8080/health',
      status: 200,
    }),
    `node -e ${shellArg(httpScript)}`
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_running', processId: 'api'}),
    "pgrep -f 'yamabiko-api/server\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_running', processId: 'fake-db'}),
    "pgrep -f 'fake-db/server\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_running', processId: 'worker'}),
    'test ! -f /workspace/run/worker.down'
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_absent', processId: 'api'}),
    "! pgrep -f 'yamabiko-api/server\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({
      type: 'process_absent',
      processId: 'alert-flood-daemon',
    }),
    "! pgrep -f 'alert-flood-daemon\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_absent', processId: 'loadgen'}),
    "! pgrep -f 'loadgen\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({
      type: 'process_absent',
      processId: 'monitor-agent',
    }),
    "! pgrep -f 'monitor-agent/agent\\.mjs' > /dev/null"
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'process_absent', processId: 'worker'}),
    'test -f /workspace/run/worker.down'
  );
  assert.equal(
    buildSuccessCheckCommand({type: 'kodama_batch_ok', jobId: 'nightly'}),
    'node /workspace/bin/kodama.mjs run /workspace/services/batch/sales.kdm'
  );
});

test('buildSuccessCheckCommand creates disk and log scripts', () => {
  const diskCommand = buildSuccessCheckCommand({
    type: 'disk_usage_below',
    path: '/workspace',
    valuePercent: 80,
  });
  assert.match(diskCommand, /^node -e '/);
  assert.match(diskCommand, /execFileSync\("df"/);
  assert.match(diskCommand, /target="\/workspace"/);
  // log volume quota counts toward disk usage so cleanup is really required
  assert.match(diskCommand, /logQuotaBytes/);
  assert.match(diskCommand, /readdirSync\("\/workspace\/logs"\)/);
  assert.match(diskCommand, /used<80/);

  const logCommand = buildSuccessCheckCommand({
    type: 'log_absent',
    path: '/workspace/logs/app.log',
    pattern: 'panic',
  });
  assert.match(logCommand, /^node -e '/);
  assert.match(logCommand, /fs\.existsSync\(p\)/);
  assert.match(logCommand, /p="\/workspace\/logs\/app\.log"/);
  assert.match(logCommand, /text\.includes\("panic"\)/);

  assert.throws(
    () => buildSuccessCheckCommand({type: 'does_not_exist'}),
    /unknown success condition type: does_not_exist/
  );
});

test('path and shell safety helpers preserve workspace boundaries', () => {
  assert.equal(shellArg("api's"), `'api'"'"'s'`);
  assert.equal(shellPathSegment('api_1.2-3'), 'api_1.2-3');
  assert.throws(() => shellPathSegment('api/down'), /invalid process id/);

  assert.equal(
    normalizeEditableWorkspacePath('/workspace/services/app.js'),
    '/workspace/services/app.js'
  );
  assert.equal(
    normalizeEditableWorkspacePath('/workspace/etc/yamabiko-api.json'),
    '/workspace/etc/yamabiko-api.json'
  );
  assert.equal(
    normalizeEditableWorkspacePath(
      '/workspace/releases/yamabiko-api.previous.json'
    ),
    '/workspace/releases/yamabiko-api.previous.json'
  );
  assert.throws(
    () => normalizeEditableWorkspacePath('/workspace/logs/debug.log'),
    /editable files must be under/
  );
  assert.throws(
    () => normalizeEditableWorkspacePath('/workspace/services/../run/x'),
    /path must stay inside/
  );
  assert.equal(isWorkspacePath('/workspace/run/x'), true);
  assert.equal(isWorkspacePath('/workspace/../x'), false);
  assert.equal(isWorkspacePath('/workspace/run/a\0b'), false);
});
