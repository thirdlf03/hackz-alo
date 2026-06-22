import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {validateScenarioDefinition} from '../../packages/shared/src/schema.ts';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const scenarioDataDir = path.join(rootDir, 'packages/scenarios/data');

test('all scenario data validates against shared contract', async () => {
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, 16);

  const ids = new Set();
  for (const {file, scenario} of scenarios) {
    const result = validateScenarioDefinition(scenario);
    assert.deepEqual(
      result.ok ? [] : result.errors,
      [],
      `${file} should be valid`
    );
    assert.equal(ids.has(scenario.id), false, `${file} id should be unique`);
    ids.add(scenario.id);
  }
});

test('scenario data exposes configured difficulty buckets', async () => {
  const scenarios = await loadScenarios();
  const difficulties = new Set(
    scenarios.map(({scenario}) => scenario.difficulty)
  );
  assert.equal(difficulties.has('beginner'), true);
  assert.equal(difficulties.has('intermediate'), true);
  assert.equal(difficulties.has('advanced'), true);
});

test('scenario validator rejects incomplete success conditions', () => {
  const scenario = validScenario({
    successConditions: [
      {type: 'http_status', url: 'http://localhost:8080/health'},
    ],
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(
    errors,
    /successConditions\[0\]\.status must be a finite number/
  );
});

test('scenario validator rejects malformed trigger params', () => {
  const scenario = validScenario({
    triggers: [
      {
        id: 'fill-log',
        atMs: 1000,
        type: 'disk_full',
        params: {path: 'workspace/logs/debug.log', bytes: -1},
      },
    ],
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(errors, /triggers\[0\]\.params\.path must be an absolute path/);
  assert.match(
    errors,
    /triggers\[0\]\.params\.bytes must be a positive integer/
  );
});

test('scenario validator rejects unsupported alert enums', () => {
  const scenario = validScenario({
    alerts: [
      {
        id: 'bad-alert',
        atMs: 1000,
        severity: 'page',
        message: 'bad',
        source: 'pager',
      },
    ],
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(
    errors,
    /alerts\[0\]\.severity must be info, warning, or critical/
  );
  assert.match(errors, /alerts\[0\]\.source must be scenario or monitor/);
});

async function loadScenarios() {
  const files = (await readdir(scenarioDataDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      scenario: JSON.parse(
        await readFile(path.join(scenarioDataDir, file), 'utf8')
      ),
    }))
  );
}

function validScenario(overrides = {}) {
  return {
    id: 'test-scenario-001',
    version: 1,
    title: 'Test Scenario',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {
      name: 'Test API',
      healthUrl: 'http://localhost:8080/health',
    },
    briefing: ['Check the service.'],
    startup: [
      {
        id: 'api',
        command: 'node /workspace/services/api/server.mjs',
        waitForPort: 8080,
      },
    ],
    triggers: [
      {
        id: 'stop-api',
        atMs: 1000,
        type: 'process_stop',
        params: {processId: 'api'},
      },
    ],
    alerts: [
      {
        id: 'api-down',
        atMs: 2000,
        severity: 'critical',
        message: 'API down',
        source: 'monitor',
      },
    ],
    successConditions: [
      {
        type: 'http_status',
        url: 'http://localhost:8080/health',
        status: 200,
      },
    ],
    runbooks: [
      {
        id: 'runbook.test',
        title: 'Test Runbook',
        body: 'Check health.',
      },
    ],
    slackMessages: [],
    ...overrides,
  };
}

function expectInvalidScenario(scenario) {
  const result = validateScenarioDefinition(scenario);
  assert.equal(result.ok, false);
  return result.errors.join('\n');
}
