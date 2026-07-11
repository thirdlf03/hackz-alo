import type {ApiResult, ParticipantRole} from '@incident/shared';

export function ok<T>(data: T): ApiResult<T> {
  return {ok: true, data};
}

export function err(code: string, message: string): ApiResult<never> {
  return {ok: false, error: {code, message}};
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return json(ok(data), init);
}

export function jsonErr(code: string, message: string, status = 500) {
  return json(err(code, message), {status});
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return jsonErr(error.code, error.message, error.status);
  }
  return jsonErr('internal_error', messageFrom(error), 500);
}

export function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'session request failed';
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function json<T>(payload: ApiResult<T>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

export function jsonResponse(payload: unknown, status: number) {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {status, headers});
}

export function hostRequiredResponse() {
  return jsonResponse({error: 'host_required'}, 403);
}

export function participantsNotReadyResponse() {
  return jsonResponse({error: 'participants_not_ready'}, 409);
}

export function roleRequiredResponse(requiredRole: ParticipantRole) {
  return jsonResponse({error: 'role_required', requiredRole}, 403);
}

export function observerReadOnlyResponse() {
  return jsonResponse({error: 'observer_read_only'}, 403);
}
