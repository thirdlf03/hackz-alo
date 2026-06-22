import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateScenarioDefinition} from '../../packages/shared/src/schema.ts';

test('navigation step schema validates optional fields', () => {
  const result = validateScenarioDefinition({
    id: 'nav-test',
    version: 1,
    title: 'Nav',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {name: 'API', healthUrl: 'http://localhost:8080/health'},
    briefing: ['hello'],
    startup: [{id: 'api', command: 'node app.js', waitForPort: 8080}],
    triggers: [],
    alerts: [],
    successConditions: [
      {type: 'http_status', url: 'http://localhost:8080/health', status: 200},
    ],
    runbooks: [{id: 'rb', title: 'RB', body: 'body'}],
    slackMessages: [],
    navigationSteps: [
      {
        id: 'step-1',
        atMs: 0,
        hint: 'look',
        panel: 'metrics',
        suggestedCommand: 'df -h',
      },
    ],
  });
  assert.equal(result.ok, true);
});
