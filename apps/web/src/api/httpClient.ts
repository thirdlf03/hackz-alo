import type {ApiResult} from '@incident/shared';

const WRITE_TOKEN_STORAGE_KEY = 'incident-write-token';

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
    return fetch(path, this.withAuth(init, path));
  }

  async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, this.withAuth(init, path));
    if (init.method === 'DELETE' && response.status === 200) {
      const payload: ApiResult<T> = await response.json();
      if (!payload.ok) throw new Error(payload.error.message);
      return payload.data;
    }
    const payload: ApiResult<T> = await response.json();
    if (!payload.ok) throw new Error(payload.error.message);
    return payload.data;
  }

  private withAuth(init: RequestInit = {}, path = '') {
    const token = this.getWriteToken();
    const method = init.method ?? 'GET';
    if (
      !token ||
      method === 'GET' ||
      method === 'HEAD' ||
      path === '/api/sessions'
    ) {
      return init;
    }
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return {...init, headers};
  }
}
