import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  appendIncidentLog,
  buildExerciseSnapshot,
  createExerciseRoom,
  createTask,
  fireInject,
  joinParticipant,
  updateParticipantCursor,
} = await tsImport(
  '../../apps/worker/src/pure/exerciseRoom.ts',
  import.meta.url
);

const scenario = {
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
  chatMessages: [],
  exercise: {
    injects: [{id: 'inject-1', title: 'Customer', body: 'ETA?'}],
  },
};

test('exercise room tracks participants, tasks, injects, and log', () => {
  let room = createExerciseRoom(scenario);
  room = joinParticipant(room, {
    participantId: 'part_1',
    displayName: 'Alice',
    role: 'incident_commander',
  });
  room = updateParticipantCursor(room, {
    participantId: 'part_1',
    x: 120,
    y: 240,
  });
  room = createTask(room, {
    taskId: 'task_1',
    title: 'Check DB pool',
    actorParticipantId: 'part_1',
  });
  room = fireInject(room, 'inject-1', {actorParticipantId: 'part_1'});
  room = appendIncidentLog(room, {
    entryId: 'log_1',
    kind: 'decision',
    body: 'Rollback is not needed yet',
    actorParticipantId: 'part_1',
  });

  const snapshot = buildExerciseSnapshot('sess_1', room);
  assert.equal(snapshot.phase, 'lobby');
  assert.equal(snapshot.participants[0].displayName, 'Alice');
  assert.equal(snapshot.participants[0].cursor.x, 120);
  assert.equal(snapshot.tasks[0].title, 'Check DB pool');
  assert.equal(snapshot.injects[0].fired, true);
  assert.equal(snapshot.incidentLog.at(-1).kind, 'decision');
});
