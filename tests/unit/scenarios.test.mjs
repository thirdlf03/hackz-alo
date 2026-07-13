import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {validateScenarioDefinition} from '../../packages/shared/src/schema.ts';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const scenarioDataDir = path.join(rootDir, 'packages/scenarios/data');

test('all scenario data validates against shared contract', async () => {
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, 20);

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

test('all scenarios have a positive integer difficultyScore', async () => {
  const scenarios = await loadScenarios();
  for (const {file, scenario} of scenarios) {
    assert.equal(
      Number.isInteger(scenario.difficultyScore),
      true,
      `${file} difficultyScore should be an integer`
    );
    assert.equal(
      scenario.difficultyScore > 0,
      true,
      `${file} difficultyScore should be positive`
    );
  }
});

test('scenarios export is sorted by difficulty bucket then difficultyScore', async () => {
  const {scenarios} = await tsImport(
    '../../packages/scenarios/src/index.ts',
    import.meta.url
  );
  const difficultyOrder = {beginner: 0, intermediate: 1, advanced: 2};

  const actual = scenarios.map((scenario) => scenario.id);
  const expected = scenarios
    .slice()
    .sort((a, b) => {
      const difficultyDiff =
        difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
      if (difficultyDiff !== 0) return difficultyDiff;
      const scoreDiff = a.difficultyScore - b.difficultyScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.id.localeCompare(b.id);
    })
    .map((scenario) => scenario.id);

  assert.deepEqual(actual, expected);
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

test('scenario validator accepts a valid topology', () => {
  const scenario = validScenario({
    topology: {
      nodes: [
        {id: 'user', label: 'ユーザー', kind: 'external'},
        {id: 'api', label: 'やまびこ API', kind: 'service', processId: 'api'},
      ],
      edges: [{from: 'user', to: 'api'}],
    },
  });

  const result = validateScenarioDefinition(scenario);
  assert.equal(result.ok, true);
});

test('scenario validator rejects duplicate topology node ids', () => {
  const scenario = validScenario({
    topology: {
      nodes: [
        {id: 'user', label: 'ユーザー', kind: 'external'},
        {id: 'user', label: 'ユーザー2', kind: 'external'},
      ],
      edges: [],
    },
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(errors, /topology\.nodes\[1\]\.id must be unique/);
});

test('scenario validator rejects topology edges referencing unknown nodes', () => {
  const scenario = validScenario({
    topology: {
      nodes: [{id: 'user', label: 'ユーザー', kind: 'external'}],
      edges: [{from: 'user', to: 'missing'}],
    },
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(
    errors,
    /topology\.edges\[0\]\.to must reference an existing node id/
  );
});

test('scenario validator rejects topology processId not present in startup', () => {
  const scenario = validScenario({
    topology: {
      nodes: [
        {
          id: 'ghost',
          label: 'Ghost',
          kind: 'service',
          processId: 'not-a-startup-id',
        },
      ],
      edges: [],
    },
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(
    errors,
    /topology\.nodes\[0\]\.processId must reference a startup id/
  );
});

test('scenario validator rejects self-loop topology edges', () => {
  const scenario = validScenario({
    topology: {
      nodes: [{id: 'api', label: 'やまびこ API', kind: 'service'}],
      edges: [{from: 'api', to: 'api'}],
    },
  });

  const errors = expectInvalidScenario(scenario);
  assert.match(
    errors,
    /topology\.edges\[0\] must not be a self loop \(from equals to\)/
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
    difficultyScore: 100,
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
    chatMessages: [],
    ...overrides,
  };
}

function expectInvalidScenario(scenario) {
  const result = validateScenarioDefinition(scenario);
  assert.equal(result.ok, false);
  return result.errors.join('\n');
}
