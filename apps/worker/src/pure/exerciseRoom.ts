import type {
  AfterActionReport,
  ExerciseInject,
  ExercisePhase,
  ExerciseSnapshot,
  ExerciseTask,
  ExerciseTaskStatus,
  HotwashNote,
  IncidentLogEntry,
  IncidentLogEntryKind,
  ParticipantPresence,
  ParticipantRole,
  ScenarioDefinition,
} from '@incident/shared';

const participantRoles = new Set<ParticipantRole>([
  'incident_commander',
  'ops',
  'scribe',
  'comms',
  'facilitator',
  'observer',
]);

const taskStatuses = new Set<ExerciseTaskStatus>([
  'open',
  'in_progress',
  'done',
  'blocked',
]);

const logKinds = new Set<IncidentLogEntryKind>([
  'note',
  'decision',
  'hypothesis',
  'comms',
  'follow_up',
  'role_deviation',
]);

export interface StoredExerciseRoom {
  phase: ExercisePhase;
  hostParticipantId: string | null;
  participants: ParticipantPresence[];
  tasks: ExerciseTask[];
  injects: ExerciseInject[];
  incidentLog: IncidentLogEntry[];
  hotwashNotes: HotwashNote[];
}

export function createExerciseRoom(
  scenario: ScenarioDefinition,
  hostParticipantId: string | null = null
): StoredExerciseRoom {
  return {
    phase: 'lobby',
    hostParticipantId,
    participants: [],
    tasks: [],
    injects: (scenario.exercise?.injects ?? []).map((inject) => ({
      id: inject.id,
      title: inject.title,
      body: inject.body,
      fired: false,
      ...(inject.atMs !== undefined ? {atMs: inject.atMs} : {}),
      ...(inject.roleHint !== undefined ? {roleHint: inject.roleHint} : {}),
    })),
    incidentLog: [],
    hotwashNotes: [],
  };
}

export function buildExerciseSnapshot(
  sessionId: string,
  room: StoredExerciseRoom,
  nowIso = new Date().toISOString()
): ExerciseSnapshot {
  return {
    sessionId,
    phase: room.phase,
    hostParticipantId: room.hostParticipantId,
    participants: room.participants.map((participant) =>
      markOnline(participant, nowIso)
    ),
    tasks: room.tasks,
    injects: room.injects,
    incidentLog: room.incidentLog.slice(-100),
    hotwashNotes: room.hotwashNotes,
  };
}

export function joinParticipant(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const participantId = cleanId(input.participantId, 'participant');
  const existing = room.participants.find(
    (participant) => participant.participantId === participantId
  );
  const next: ParticipantPresence = {
    participantId,
    displayName: cleanDisplayName(input.displayName, participantId),
    role: cleanRole(input.role, existing?.role ?? 'ops'),
    ready: input.ready === true || existing?.ready === true,
    online: true,
    joinedAt: existing?.joinedAt ?? nowIso,
    lastSeenAt: nowIso,
    ...((cleanOptionalString(input.teamId) ?? existing?.teamId)
      ? {teamId: cleanOptionalString(input.teamId) ?? existing?.teamId}
      : {}),
    ...(existing?.cursor ? {cursor: existing.cursor} : {}),
  };
  const isFirstParticipant = room.participants.length === 0;
  const updated = upsertParticipant(room, next);
  if (updated.hostParticipantId === null && isFirstParticipant) {
    return {...updated, hostParticipantId: participantId};
  }
  return updated;
}

export function heartbeatParticipant(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const participantId = cleanId(input.participantId, 'participant');
  const ready = input.ready === undefined ? undefined : input.ready === true;
  return updateParticipant(room, participantId, (participant) => ({
    ...participant,
    ...(ready === undefined ? {} : {ready}),
    online: true,
    lastSeenAt: nowIso,
  }));
}

export function updateParticipantCursor(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const participantId = cleanId(input.participantId, 'participant');
  return updateParticipant(room, participantId, (participant) => ({
    ...participant,
    online: true,
    lastSeenAt: nowIso,
    cursor: {
      x: clampNumber(input.x, 0, 1920, participant.cursor?.x ?? 960),
      y: clampNumber(input.y, 0, 1080, participant.cursor?.y ?? 540),
      visible: input.visible !== false,
      updatedAt: nowIso,
    },
  }));
}

export function updateParticipantRole(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const participantId = cleanId(input.participantId, 'participant');
  const role = cleanRole(input.role, 'ops');
  return updateParticipant(room, participantId, (participant) => ({
    ...participant,
    role,
    online: true,
    lastSeenAt: nowIso,
  }));
}

export function createTask(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const task: ExerciseTask = {
    id: cleanId(input.taskId, 'task'),
    title: cleanRequiredString(input.title, 'task title').slice(0, 160),
    status: cleanTaskStatus(input.status, 'open'),
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(cleanOptionalString(input.assigneeParticipantId)
      ? {
          assigneeParticipantId: cleanOptionalString(
            input.assigneeParticipantId
          ),
        }
      : {}),
    ...(cleanOptionalString(input.actorParticipantId)
      ? {createdByParticipantId: cleanOptionalString(input.actorParticipantId)}
      : {}),
  };
  if (room.tasks.some((item) => item.id === task.id)) return room;
  return {...room, tasks: [...room.tasks, task]};
}

export function updateTask(
  room: StoredExerciseRoom,
  taskId: string,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  return {
    ...room,
    tasks: room.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        ...(typeof input.title === 'string' && input.title.trim()
          ? {title: input.title.trim().slice(0, 160)}
          : {}),
        ...(input.status === undefined
          ? {}
          : {status: cleanTaskStatus(input.status, task.status)}),
        ...(input.assigneeParticipantId === null
          ? {assigneeParticipantId: undefined}
          : cleanOptionalString(input.assigneeParticipantId)
            ? {
                assigneeParticipantId: cleanOptionalString(
                  input.assigneeParticipantId
                ),
              }
            : {}),
        updatedAt: nowIso,
      };
    }),
  };
}

export function deleteTask(
  room: StoredExerciseRoom,
  taskId: string
): StoredExerciseRoom {
  return {...room, tasks: room.tasks.filter((task) => task.id !== taskId)};
}

export function appendIncidentLog(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const entry: IncidentLogEntry = {
    id: cleanId(input.entryId, 'log'),
    kind: cleanLogKind(input.kind, 'note'),
    body: cleanRequiredString(input.body, 'incident log body').slice(0, 2000),
    createdAt: nowIso,
    ...(cleanOptionalString(input.actorParticipantId)
      ? {actorParticipantId: cleanOptionalString(input.actorParticipantId)}
      : {}),
  };
  if (room.incidentLog.some((item) => item.id === entry.id)) return room;
  return {...room, incidentLog: [...room.incidentLog, entry]};
}

export function updateIncidentLog(
  room: StoredExerciseRoom,
  entryId: string,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  return {
    ...room,
    incidentLog: room.incidentLog.map((entry) => {
      if (entry.id !== entryId) return entry;
      return {
        ...entry,
        ...(typeof input.body === 'string' && input.body.trim()
          ? {body: input.body.trim().slice(0, 2000)}
          : {}),
        ...(input.kind === undefined
          ? {}
          : {kind: cleanLogKind(input.kind, entry.kind)}),
        updatedAt: nowIso,
      };
    }),
  };
}

export function deleteIncidentLog(
  room: StoredExerciseRoom,
  entryId: string
): StoredExerciseRoom {
  return {
    ...room,
    incidentLog: room.incidentLog.filter((entry) => entry.id !== entryId),
  };
}

export function fireInject(
  room: StoredExerciseRoom,
  injectId: string,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const inject = room.injects.find((item) => item.id === injectId);
  const injects = inject
    ? room.injects.map((item) =>
        item.id === injectId
          ? {
              ...item,
              fired: true,
              firedAt: item.firedAt ?? nowIso,
              ...(cleanOptionalString(input.actorParticipantId)
                ? {
                    firedByParticipantId: cleanOptionalString(
                      input.actorParticipantId
                    ),
                  }
                : {}),
            }
          : item
      )
    : [
        ...room.injects,
        {
          id: injectId,
          title: cleanRequiredString(input.title, 'inject title').slice(0, 160),
          body: cleanRequiredString(input.body, 'inject body').slice(0, 2000),
          fired: true,
          firedAt: nowIso,
          ...(cleanOptionalString(input.actorParticipantId)
            ? {
                firedByParticipantId: cleanOptionalString(
                  input.actorParticipantId
                ),
              }
            : {}),
        },
      ];
  return {
    ...room,
    injects,
    incidentLog: [
      ...room.incidentLog,
      {
        id: `log_${injectId}_${Date.parse(nowIso).toString(36)}`,
        kind: 'note',
        body: `Inject: ${inject?.title ?? cleanRequiredString(input.title, 'inject title')}`,
        createdAt: nowIso,
        ...(cleanOptionalString(input.actorParticipantId)
          ? {actorParticipantId: cleanOptionalString(input.actorParticipantId)}
          : {}),
      },
    ],
  };
}

export function submitHotwash(
  room: StoredExerciseRoom,
  input: Record<string, unknown>,
  nowIso = new Date().toISOString()
): StoredExerciseRoom {
  const note: HotwashNote = {
    id: cleanId(input.noteId, 'hotwash'),
    wentWell: cleanRequiredString(input.wentWell, 'wentWell').slice(0, 1000),
    improve: cleanRequiredString(input.improve, 'improve').slice(0, 1000),
    followUp: cleanRequiredString(input.followUp, 'followUp').slice(0, 1000),
    createdAt: nowIso,
    ...(cleanOptionalString(input.participantId)
      ? {participantId: cleanOptionalString(input.participantId)}
      : {}),
  };
  if (room.hotwashNotes.some((item) => item.id === note.id)) return room;
  return {
    ...room,
    phase: 'hotwash',
    hotwashNotes: [...room.hotwashNotes, note],
  };
}

export function generateAfterActionReport(
  sessionId: string,
  room: StoredExerciseRoom,
  nowIso = new Date().toISOString()
): AfterActionReport {
  return {
    sessionId,
    generatedAt: nowIso,
    participants: room.participants,
    tasks: room.tasks,
    injects: room.injects,
    incidentLog: room.incidentLog,
    hotwashNotes: room.hotwashNotes,
  };
}

export function setExercisePhase(
  room: StoredExerciseRoom,
  phase: ExercisePhase
): StoredExerciseRoom {
  if (room.phase === phase) return room;
  return {...room, phase};
}

export type HostGateDecision = {allowed: true} | {allowed: false};

/**
 * Gates host-only actions (start, injectFire, phase transitions). When a
 * host is recorded for the room, only that participant may act; the
 * `facilitator` role itself carries no authority here, it is display-only.
 * When no host is recorded (legacy rooms bootstrapped before host tracking
 * existed) everyone is allowed, matching prior behavior.
 */
export function canPerformRoleGatedAction(
  room: StoredExerciseRoom,
  participantId: string | undefined
): HostGateDecision {
  if (room.hostParticipantId === null) return {allowed: true};
  return participantId === room.hostParticipantId
    ? {allowed: true}
    : {allowed: false};
}

/**
 * Gates sandbox *operations* — terminal input, terminal resize, and
 * editor file writes — to the `ops` and `facilitator` roles. It does not
 * gate connecting to the terminal WebSocket itself: the output mirror is
 * broadcast to every role, including read-token-only observers, so they
 * can watch along.
 *
 * For terminal *input* specifically, this same predicate is also
 * evaluated server-side now (SessionDurableObject.terminal()), gated
 * first on a real write-token check the client cannot forge — see
 * sessionRoutes.ts's ws/terminal route (x-incident-write-access header)
 * and terminalRelayPolicy.ts for the frame classification that enforces
 * it on the wire. A connection without a valid write token can never
 * operate, which *is* a real security boundary against read-only
 * viewers. Among write-token holders, though, participantId/role are
 * still self-reported over the WS query string with no per-participant
 * authentication, so the ops/facilitator role check itself remains a
 * cooperative-play convention rather than a security boundary between
 * participants who all hold the same shared write token (one could still
 * claim another's participantId to appear as ops). Terminal resize and
 * editor writes go over discrete REST calls the SessionDurableObject
 * also gates with this same predicate. Solo rescue: when at most one
 * participant is online the room is effectively single-player and no
 * restriction applies. In multiplayer, an unknown or missing
 * participantId is rejected. Mirrored client-side by
 * apps/web/src/pure/rolePermissions.ts `canOperateSandbox` (UX +
 * defense in depth on top of the server-side gate).
 */
export function canOperateSandbox(
  room: StoredExerciseRoom,
  participantId: string | undefined,
  nowIso = new Date().toISOString()
): HostGateDecision {
  if (countOnlineParticipants(room, nowIso) <= 1) return {allowed: true};
  const participant = findParticipant(room, participantId);
  if (!participant) return {allowed: false};
  return participant.role === 'ops' || participant.role === 'facilitator'
    ? {allowed: true}
    : {allowed: false};
}

/**
 * Gates record contributions (task create/update, incident log entries,
 * hotwash notes): observers are read-only. Same solo rescue and
 * unknown-participant rejection as `canOperateSandbox`. Mirrored
 * client-side by apps/web/src/pure/rolePermissions.ts
 * `canContributeRecords`.
 */
export function canContributeRecords(
  room: StoredExerciseRoom,
  participantId: string | undefined,
  nowIso = new Date().toISOString()
): HostGateDecision {
  if (countOnlineParticipants(room, nowIso) <= 1) return {allowed: true};
  const participant = findParticipant(room, participantId);
  if (!participant) return {allowed: false};
  return participant.role === 'observer' ? {allowed: false} : {allowed: true};
}

function countOnlineParticipants(room: StoredExerciseRoom, nowIso: string) {
  return room.participants.filter((participant) =>
    isParticipantOnline(participant, nowIso)
  ).length;
}

function findParticipant(
  room: StoredExerciseRoom,
  participantId: string | undefined
) {
  if (!participantId) return undefined;
  return room.participants.find(
    (participant) => participant.participantId === participantId
  );
}

export function areParticipantsReadyToStart(
  room: StoredExerciseRoom,
  nowIso = new Date().toISOString()
): boolean {
  const onlineNonObservers = room.participants.filter(
    (participant) =>
      participant.role !== 'observer' &&
      isParticipantOnline(participant, nowIso)
  );
  if (onlineNonObservers.length <= 1) return true;
  return onlineNonObservers.every((participant) => participant.ready);
}

function upsertParticipant(
  room: StoredExerciseRoom,
  participant: ParticipantPresence
) {
  const found = room.participants.some(
    (item) => item.participantId === participant.participantId
  );
  return {
    ...room,
    participants: found
      ? room.participants.map((item) =>
          item.participantId === participant.participantId ? participant : item
        )
      : [...room.participants, participant],
  };
}

function updateParticipant(
  room: StoredExerciseRoom,
  participantId: string,
  updater: (participant: ParticipantPresence) => ParticipantPresence
) {
  const existing = room.participants.find(
    (participant) => participant.participantId === participantId
  );
  if (!existing) {
    return joinParticipant(room, {participantId}, new Date().toISOString());
  }
  return upsertParticipant(room, updater(existing));
}

export function isParticipantOnline(
  participant: ParticipantPresence,
  nowIso = new Date().toISOString()
): boolean {
  return Date.parse(nowIso) - Date.parse(participant.lastSeenAt) < 30_000;
}

function markOnline(participant: ParticipantPresence, nowIso: string) {
  return {
    ...participant,
    online: isParticipantOnline(participant, nowIso),
  };
}

function cleanRole(value: unknown, fallback: ParticipantRole): ParticipantRole {
  return typeof value === 'string' &&
    participantRoles.has(value as ParticipantRole)
    ? (value as ParticipantRole)
    : fallback;
}

function cleanTaskStatus(
  value: unknown,
  fallback: ExerciseTaskStatus
): ExerciseTaskStatus {
  return typeof value === 'string' &&
    taskStatuses.has(value as ExerciseTaskStatus)
    ? (value as ExerciseTaskStatus)
    : fallback;
}

function cleanLogKind(
  value: unknown,
  fallback: IncidentLogEntryKind
): IncidentLogEntryKind {
  return typeof value === 'string' &&
    logKinds.has(value as IncidentLogEntryKind)
    ? (value as IncidentLogEntryKind)
    : fallback;
}

function cleanDisplayName(value: unknown, participantId: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 40);
  }
  return `Player ${participantId.slice(-4)}`;
}

function cleanRequiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function cleanOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : undefined;
}

function cleanId(value: unknown, prefix: string) {
  if (
    typeof value === 'string' &&
    /^[a-zA-Z0-9_-]{3,120}$/.test(value.trim())
  ) {
    return value.trim();
  }
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
