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

test('exercise inject schema validates optional room events', () => {
  const result = validateScenarioDefinition({
    id: 'exercise-test',
    version: 1,
    title: 'Exercise',
    difficulty: 'intermediate',
    timeLimitMinutes: 10,
    service: {name: 'API', healthUrl: 'http://localhost:8080/health'},
    briefing: ['hello'],
    startup: [{id: 'api', command: 'node app.js'}],
    triggers: [],
    alerts: [],
    successConditions: [
      {type: 'http_status', url: 'http://localhost:8080/health', status: 200},
    ],
    runbooks: [{id: 'rb', title: 'RB', body: 'body'}],
    slackMessages: [],
    exercise: {
      injects: [
        {
          id: 'customer-impact',
          atMs: 120000,
          title: '顧客問い合わせ',
          body: '問い合わせが増えています',
          roleHint: 'comms',
        },
      ],
    },
  });
  assert.equal(result.ok, true);

  const invalid = validateScenarioDefinition({
    id: 'exercise-test',
    version: 1,
    title: 'Exercise',
    difficulty: 'intermediate',
    timeLimitMinutes: 10,
    service: {name: 'API', healthUrl: 'http://localhost:8080/health'},
    briefing: ['hello'],
    startup: [{id: 'api', command: 'node app.js'}],
    triggers: [],
    alerts: [],
    successConditions: [
      {type: 'http_status', url: 'http://localhost:8080/health', status: 200},
    ],
    runbooks: [{id: 'rb', title: 'RB', body: 'body'}],
    slackMessages: [],
    exercise: {
      injects: [{id: 'bad-role', title: 'x', body: 'y', roleHint: 'manager'}],
    },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /roleHint/);
});
