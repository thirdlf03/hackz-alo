import type {ApiResult} from '@incident/shared';
import {
  getBrowserPerf,
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  type ActivePerfSpan,
} from '@incident/observability/browser';

const WRITE_TOKEN_STORAGE_KEY = 'incident-write-token';
const READ_TOKEN_QUERY_PARAM = 'readToken';

export class HttpClient {
  private writeToken: string | undefined;

  setWriteToken(token: string | undefined) {
    this.writeToken = token;
    if (typeof sessionStorage === 'undefined') return;
    if (token) sessionStorage.setItem(WRITE_TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(WRITE_TOKEN_STORAGE_KEY);
  }

  getWriteToken() {
    if (this.writeToken) return this.writeToken;
    if (typeof sessionStorage === 'undefined') return undefined;
    const stored = sessionStorage.getItem(WRITE_TOKEN_STORAGE_KEY);
    this.writeToken = stored ?? undefined;
    return this.writeToken;
  }

  clearWriteToken() {
    this.setWriteToken(undefined);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, {method: 'GET'});
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const span = this.startRequestSpan(path, init);
    try {
      const response = await fetch(
        path,
        this.withPerfTrace(this.withAuth(init, path), span)
      );
      span?.setAttribute(INCIDENT_ATTRS.httpStatusCode, response.status);
      span?.end();
      return response;
    } catch (error) {
      span?.end({status: 'error', error});
      throw error;
    }
  }

  async request<T>(path: string, init: RequestInit): Promise<T> {
    const span = this.startRequestSpan(path, init);
    try {
      const response = await fetch(
        path,
        this.withPerfTrace(this.withAuth(init, path), span)
      );
      span?.setAttribute(INCIDENT_ATTRS.httpStatusCode, response.status);
      if (init.method === 'DELETE' && response.status === 200) {
        const payload: ApiResult<T> = await response.json();
        if (!payload.ok) throw new Error(payload.error.message);
        span?.end();
        return payload.data;
      }
      const payload: ApiResult<T> = await response.json();
      if (!payload.ok) throw new Error(payload.error.message);
      span?.end();
      return payload.data;
    } catch (error) {
      span?.end({status: 'error', error});
      throw error;
    }
  }

  private withAuth(init: RequestInit = {}, path = '') {
    const token = this.tokenForPath(path);
    if (!token) {
      return init;
    }
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return {...init, headers};
  }

  private tokenForPath(path: string) {
    if (path === '/api/sessions') return undefined;
    const normalizedPath = path.split('?')[0] ?? path;
    const protectsReplay =
      normalizedPath.startsWith('/api/replays/') &&
      normalizedPath !== '/api/replays/featured';
    const protectsSession = normalizedPath.startsWith('/api/sessions/');
    if (!protectsReplay && !protectsSession) return undefined;

    const writeToken = this.getWriteToken();
    if (writeToken) return writeToken;
    return protectsReplay ? this.readTokenFromLocation() : undefined;
  }

  private readTokenFromLocation() {
    if (typeof window === 'undefined') return undefined;
    const token = new URLSearchParams(window.location.search)
      .get(READ_TOKEN_QUERY_PARAM)
      ?.trim();
    return token && token.length > 0 ? token : undefined;
  }

  private startRequestSpan(
    path: string,
    init: RequestInit | undefined
  ): ActivePerfSpan | undefined {
    const perf = getBrowserPerf();
    if (!perf.enabled) return undefined;
    return perf.startSpan(INCIDENT_SPAN_NAMES.apiRequest, {
      attributes: {
        [INCIDENT_ATTRS.httpMethod]: init?.method ?? 'GET',
        [INCIDENT_ATTRS.httpTarget]: path.split('?')[0] ?? path,
      },
    });
  }

  private withPerfTrace(
    init: RequestInit = {},
    span: ActivePerfSpan | undefined
  ): RequestInit {
    if (!span) return init;
    const headers = new Headers(init.headers ?? {});
    headers.set('traceparent', span.traceparent);
    return {...init, headers};
  }
}
