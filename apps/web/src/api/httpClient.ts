import type {ApiResult} from '@incident/shared';

export class HttpClient {
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
    return fetch(path, init);
  }

  async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    if (init.method === 'DELETE' && response.status === 200) {
      const payload: ApiResult<T> = await response.json();
      if (!payload.ok) throw new Error(payload.error.message);
      return payload.data;
    }
    const payload: ApiResult<T> = await response.json();
    if (!payload.ok) throw new Error(payload.error.message);
    return payload.data;
  }
}
