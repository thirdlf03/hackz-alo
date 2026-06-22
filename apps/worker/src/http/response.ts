import type {ApiResult} from '@incident/shared';

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
