import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  appendIncidentLog,
  areParticipantsReadyToStart,
  buildExerciseSnapshot,
  canPerformRoleGatedAction,
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

test('canPerformRoleGatedAction allows anyone when the room has no host', () => {
  let room = createExerciseRoom(scenario);
  room = joinParticipant(room, {participantId: 'part_1', role: 'ops'});
  // No host assigned at creation time (legacy/compat path): unrestricted.
  room = {...room, hostParticipantId: null};
  assert.equal(canPerformRoleGatedAction(room, 'part_1').allowed, true);
  assert.equal(canPerformRoleGatedAction(room, undefined).allowed, true);
});

test('canPerformRoleGatedAction restricts start/injectFire/phase actions to the host', () => {
  const room = createExerciseRoom(scenario, 'host_1');
  assert.equal(canPerformRoleGatedAction(room, 'host_1').allowed, true);
  assert.equal(canPerformRoleGatedAction(room, 'guest_1').allowed, false);
  assert.equal(canPerformRoleGatedAction(room, undefined).allowed, false);
});

test('createExerciseRoom defaults hostParticipantId to null when not provided', () => {
  const room = createExerciseRoom(scenario);
  assert.equal(room.hostParticipantId, null);
});

test('joinParticipant promotes the first joiner to host when the room has no host', () => {
  let room = createExerciseRoom(scenario);
  assert.equal(room.hostParticipantId, null);
  room = joinParticipant(room, {participantId: 'first_joiner', role: 'ops'});
  assert.equal(room.hostParticipantId, 'first_joiner');
  room = joinParticipant(room, {participantId: 'second_joiner', role: 'ops'});
  assert.equal(room.hostParticipantId, 'first_joiner');
});

test('joinParticipant does not override an already-assigned host', () => {
  let room = createExerciseRoom(scenario, 'creator_1');
  room = joinParticipant(room, {participantId: 'creator_1', role: 'ops'});
  assert.equal(room.hostParticipantId, 'creator_1');
  room = joinParticipant(room, {participantId: 'someone_else', role: 'ops'});
  assert.equal(room.hostParticipantId, 'creator_1');
});

test('buildExerciseSnapshot exposes hostParticipantId', () => {
  const room = createExerciseRoom(scenario, 'host_1');
  const snapshot = buildExerciseSnapshot('sess_1', room);
  assert.equal(snapshot.hostParticipantId, 'host_1');
});

test('areParticipantsReadyToStart allows solo play regardless of ready flag', () => {
  let room = createExerciseRoom(scenario);
  room = joinParticipant(room, {participantId: 'solo_1', role: 'ops', ready: false});
  assert.equal(areParticipantsReadyToStart(room), true);
});

test('areParticipantsReadyToStart requires all online non-observer participants ready', () => {
  let room = createExerciseRoom(scenario);
  room = joinParticipant(room, {participantId: 'p_1', role: 'ops', ready: true});
  room = joinParticipant(room, {participantId: 'p_2', role: 'incident_commander', ready: false});
  assert.equal(areParticipantsReadyToStart(room), false);
  room = joinParticipant(room, {participantId: 'p_2', role: 'incident_commander', ready: true});
  assert.equal(areParticipantsReadyToStart(room), true);
});

test('areParticipantsReadyToStart ignores observers and stale participants', () => {
  const staleAt = '2024-01-01T00:00:00.000Z';
  const freshAt = '2024-01-01T00:00:40.000Z';
  const checkAt = '2024-01-01T00:00:41.000Z';
  let room = createExerciseRoom(scenario);
  room = joinParticipant(room, {participantId: 'p_1', role: 'ops', ready: true}, freshAt);
  room = joinParticipant(room, {participantId: 'p_2', role: 'incident_commander', ready: true}, freshAt);
  room = joinParticipant(room, {participantId: 'obs_1', role: 'observer', ready: false}, freshAt);
  room = joinParticipant(room, {participantId: 'stale_1', role: 'ops', ready: false}, staleAt);
  assert.equal(areParticipantsReadyToStart(room, checkAt), true);
});
