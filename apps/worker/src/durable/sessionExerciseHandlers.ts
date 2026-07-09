import type {
  ParticipantCursorEvent,
  ScenarioDefinition,
} from '@incident/shared';
import {getScenario} from '@incident/scenarios';
import {readJsonObjectBody, RequestBodyError} from '../http/body.js';
import {
  HttpError,
  hostRequiredResponse,
  jsonOk,
  messageFrom,
} from '../http/response.js';
import {logStructured} from '../http/requestLog.js';
import type {Bindings} from '../types.js';
import {
  appendIncidentLog,
  buildExerciseSnapshot,
  canPerformRoleGatedAction,
  createExerciseRoom,
  createTask,
  fireInject,
  generateAfterActionReport,
  heartbeatParticipant,
  joinParticipant,
  setExercisePhase,
  submitHotwash,
  updateParticipantCursor,
  updateParticipantRole,
  updateTask,
  type StoredExerciseRoom,
} from '../pure/exerciseRoom.js';
import type {StoredSession} from './sessionState.js';
import type {SessionSseHub} from './sessionSseHub.js';

const SESSION_CONTROL_BODY_MAX_BYTES = 8 * 1024;

export interface SessionExerciseDeps {
  env: Bindings;
  storage: DurableObjectStorage;
  sseHub: SessionSseHub;
  requireSession: () => Promise<StoredSession>;
}

export class SessionExerciseHub {
  constructor(private readonly deps: SessionExerciseDeps) {}

  async snapshot(session: StoredSession) {
    return buildExerciseSnapshot(
      session.sessionId,
      await this.loadOrCreate(session)
    );
  }

  async loadOrCreate(session?: StoredSession, hostParticipantId?: string) {
    const existing =
      await this.deps.storage.get<StoredExerciseRoom>('exercise');
    if (existing) return existing;
    const resolved = session ?? (await this.deps.requireSession());
    const created = createExerciseRoom(
      requireScenario(resolved.scenarioId),
      hostParticipantId ?? null
    );
    await this.deps.storage.put('exercise', created);
    return created;
  }

  async save(session: StoredSession, room: StoredExerciseRoom) {
    await this.deps.storage.put('exercise', room);
    await persistExerciseProjection(
      this.deps.env,
      session.sessionId,
      room
    ).catch((error: unknown) => {
      logStructured('exercise_projection_failed', {
        sessionId: session.sessionId,
        message: messageFrom(error),
      });
    });
    return buildExerciseSnapshot(session.sessionId, room);
  }

  async saveResponse(
    session: StoredSession,
    room: StoredExerciseRoom,
    eventName: string
  ) {
    const snapshot = await this.save(session, room);
    this.deps.sseHub.broadcast(eventName, snapshot);
    this.deps.sseHub.broadcast('exercise_state', snapshot);
    return jsonOk({exercise: snapshot});
  }

  async state() {
    const session = await this.deps.requireSession();
    return jsonOk(await this.snapshot(session));
  }

  async participantJoin(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = joinParticipant(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'presence');
  }

  async participantHeartbeat(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = heartbeatParticipant(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'presence');
  }

  async participantCursor(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = updateParticipantCursor(
      await this.loadOrCreate(session),
      body
    );
    await this.deps.storage.put('exercise', room);

    const requestedId =
      typeof body.participantId === 'string' ? body.participantId.trim() : '';
    const participant = room.participants.find(
      (entry) => entry.participantId === requestedId
    );
    if (!participant?.cursor) {
      throw new HttpError(404, 'not_found', 'participant not found');
    }

    const event: ParticipantCursorEvent = {
      sessionId: session.sessionId,
      participantId: participant.participantId,
      x: participant.cursor.x,
      y: participant.cursor.y,
      visible: participant.cursor.visible,
      updatedAt: participant.cursor.updatedAt,
    };
    this.deps.sseHub.broadcast('cursor', event);
    return jsonOk({ok: true});
  }

  async participantRole(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = updateParticipantRole(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'presence');
  }

  async participantLeave(request: Request) {
    const session = await this.deps.requireSession();
    const body = (await readControlBody(request)) as {participantId?: unknown};
    const participantId =
      typeof body.participantId === 'string' ? body.participantId : undefined;
    const current = await this.loadOrCreate(session);
    const room: StoredExerciseRoom = {
      ...current,
      participants: current.participants.map((participant) =>
        participant.participantId === participantId
          ? {
              ...participant,
              online: false,
              lastSeenAt: new Date().toISOString(),
            }
          : participant
      ),
    };
    return this.saveResponse(session, room, 'presence');
  }

  async ready(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = heartbeatParticipant(await this.loadOrCreate(session), {
      ...body,
      ready: true,
    });
    return this.saveResponse(session, room, 'presence');
  }

  async taskCreate(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = createTask(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'task');
  }

  async taskUpdate(request: Request) {
    const session = await this.deps.requireSession();
    const body = (await readControlBody(request)) as {taskId?: unknown};
    if (typeof body.taskId !== 'string') {
      throw new HttpError(400, 'bad_request', 'taskId is required');
    }
    const room = updateTask(
      await this.loadOrCreate(session),
      body.taskId,
      body
    );
    return this.saveResponse(session, room, 'task');
  }

  async injectFire(request: Request) {
    const session = await this.deps.requireSession();
    const body = (await readControlBody(request)) as {
      injectId?: unknown;
      participantId?: unknown;
    };
    if (typeof body.injectId !== 'string') {
      throw new HttpError(400, 'bad_request', 'injectId is required');
    }
    const room = await this.loadOrCreate(session);
    const participantId =
      typeof body.participantId === 'string' ? body.participantId : undefined;
    const decision = canPerformRoleGatedAction(room, participantId);
    if (!decision.allowed) {
      return hostRequiredResponse();
    }
    const fired = fireInject(room, body.injectId, body);
    return this.saveResponse(session, fired, 'inject');
  }

  async phaseAdvance(request: Request) {
    const session = await this.deps.requireSession();
    const body = (await readControlBody(request)) as {
      participantId?: unknown;
      phase?: unknown;
    };
    const room = await this.loadOrCreate(session);
    const participantId =
      typeof body.participantId === 'string' ? body.participantId : undefined;
    const decision = canPerformRoleGatedAction(room, participantId);
    if (!decision.allowed) {
      return hostRequiredResponse();
    }
    if (body.phase !== 'briefing') {
      throw new HttpError(400, 'bad_request', 'unsupported phase transition');
    }
    if (room.phase !== 'lobby') {
      return this.saveResponse(session, room, 'phase');
    }
    return this.saveResponse(
      session,
      setExercisePhase(room, 'briefing'),
      'phase'
    );
  }

  async fireScheduledInject(session: StoredSession, injectId: string) {
    const room = await this.loadOrCreate(session);
    const inject = room.injects.find((item) => item.id === injectId);
    if (!inject || inject.fired) return;
    await this.saveResponse(session, fireInject(room, injectId, {}), 'inject');
  }

  async incidentLog(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = appendIncidentLog(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'incident_log');
  }

  async hotwash(request: Request) {
    const session = await this.deps.requireSession();
    const body = await readControlBody(request);
    const room = submitHotwash(await this.loadOrCreate(session), body);
    return this.saveResponse(session, room, 'hotwash');
  }

  async aar() {
    const session = await this.deps.requireSession();
    const room = await this.loadOrCreate(session);
    const report = generateAfterActionReport(session.sessionId, room);
    await persistAfterActionReport(this.deps.env, session.sessionId, report);
    return jsonOk({report});
  }
}

export function requireScenario(id: string): ScenarioDefinition {
  const scenario = getScenario(id);
  if (!scenario) {
    throw new HttpError(400, 'bad_request', `unknown scenario: ${id}`);
  }
  return scenario;
}

async function readControlBody(request: Request) {
  try {
    return await readJsonObjectBody(request, SESSION_CONTROL_BODY_MAX_BYTES, {
      emptyValue: {},
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new HttpError(error.status, error.code, error.message);
    }
    throw error;
  }
}

async function persistExerciseProjection(
  env: Bindings,
  sessionId: string,
  room: StoredExerciseRoom
) {
  const statements: D1PreparedStatement[] = [];
  for (const participant of room.participants) {
    statements.push(
      env.DB.prepare(
        `insert into session_participants
         (session_id, participant_id, display_name, role, team_id, ready, joined_at, last_seen_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(session_id, participant_id) do update set
           display_name = excluded.display_name,
           role = excluded.role,
           team_id = excluded.team_id,
           ready = excluded.ready,
           last_seen_at = excluded.last_seen_at`
      ).bind(
        sessionId,
        participant.participantId,
        participant.displayName,
        participant.role,
        participant.teamId ?? null,
        participant.ready ? 1 : 0,
        participant.joinedAt,
        participant.lastSeenAt
      )
    );
  }
  for (const task of room.tasks) {
    statements.push(
      env.DB.prepare(
        `insert into session_tasks
         (session_id, task_id, title, status, assignee_participant_id, created_by_participant_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(session_id, task_id) do update set
           title = excluded.title,
           status = excluded.status,
           assignee_participant_id = excluded.assignee_participant_id,
           updated_at = excluded.updated_at`
      ).bind(
        sessionId,
        task.id,
        task.title,
        task.status,
        task.assigneeParticipantId ?? null,
        task.createdByParticipantId ?? null,
        task.createdAt,
        task.updatedAt
      )
    );
  }
  for (const inject of room.injects) {
    statements.push(
      env.DB.prepare(
        `insert into session_injects
         (session_id, inject_id, title, body, fired, fired_at, fired_by_participant_id)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(session_id, inject_id) do update set
           title = excluded.title,
           body = excluded.body,
           fired = excluded.fired,
           fired_at = excluded.fired_at,
           fired_by_participant_id = excluded.fired_by_participant_id`
      ).bind(
        sessionId,
        inject.id,
        inject.title,
        inject.body,
        inject.fired ? 1 : 0,
        inject.firedAt ?? null,
        inject.firedByParticipantId ?? null
      )
    );
  }
  for (const entry of room.incidentLog) {
    statements.push(
      env.DB.prepare(
        `insert into session_incident_log
         (session_id, entry_id, kind, body, actor_participant_id, created_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(session_id, entry_id) do nothing`
      ).bind(
        sessionId,
        entry.id,
        entry.kind,
        entry.body,
        entry.actorParticipantId ?? null,
        entry.createdAt
      )
    );
  }
  for (const note of room.hotwashNotes) {
    statements.push(
      env.DB.prepare(
        `insert into session_hotwash_notes
         (session_id, note_id, participant_id, went_well, improve, follow_up, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(session_id, note_id) do nothing`
      ).bind(
        sessionId,
        note.id,
        note.participantId ?? null,
        note.wentWell,
        note.improve,
        note.followUp,
        note.createdAt
      )
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

async function persistAfterActionReport(
  env: Bindings,
  sessionId: string,
  report: unknown
) {
  const generatedAt =
    typeof report === 'object' &&
    report !== null &&
    'generatedAt' in report &&
    typeof report.generatedAt === 'string'
      ? report.generatedAt
      : new Date().toISOString();
  await env.DB.prepare(
    `insert into session_after_action_reports
     (session_id, report_json, generated_at)
     values (?, ?, ?)
     on conflict(session_id) do update set
       report_json = excluded.report_json,
       generated_at = excluded.generated_at`
  )
    .bind(sessionId, JSON.stringify(report), generatedAt)
    .run()
    .catch((error: unknown) => {
      logStructured('aar_projection_failed', {
        sessionId,
        message: messageFrom(error),
      });
    });
}
