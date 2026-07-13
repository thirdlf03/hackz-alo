// Worker ルート統合テスト用の最小 Hono 互換ハーネス。
// ルート登録関数 (registerXxxRoutes) を本物の Request/Response で駆動する。
export function createRouteHarness(defaultEnv) {
  const routes = [];
  const backgroundTasks = [];
  const app = {
    get(path, ...handlers) {
      routes.push({method: 'GET', path, handler: compose(handlers)});
    },
    post(path, ...handlers) {
      routes.push({method: 'POST', path, handler: compose(handlers)});
    },
    put(path, ...handlers) {
      routes.push({method: 'PUT', path, handler: compose(handlers)});
    },
    delete(path, ...handlers) {
      routes.push({method: 'DELETE', path, handler: compose(handlers)});
    },
    on(methods, path, handler) {
      for (const method of methods) {
        routes.push({method, path, handler});
      }
    },
    async fetch(request, env = defaultEnv) {
      const url = new URL(request.url);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const params = matchPath(route.path, url.pathname);
        if (!params) continue;
        return route.handler(
          createContext({env, request, params, backgroundTasks})
        );
      }
      return new Response('not found', {status: 404});
    },
    // c.executionCtx.waitUntil に渡されたバックグラウンド処理を待つ。
    async flushBackground() {
      while (backgroundTasks.length > 0) {
        await Promise.allSettled(backgroundTasks.splice(0));
      }
    },
  };
  return app;
}

function compose(handlers) {
  return async (context) => {
    let index = -1;
    let response;
    async function next() {
      index += 1;
      const handler = handlers[index];
      if (!handler) return undefined;
      const result = await handler(context, next);
      if (result !== undefined) response = result;
      return result;
    }
    await next();
    return response;
  };
}

function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return undefined;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (!patternPart || !pathPart) return undefined;
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return undefined;
    }
  }
  return params;
}

function createContext({env, request, params, backgroundTasks}) {
  const responseHeaders = new Headers();
  const url = new URL(request.url);
  return {
    env,
    executionCtx: {
      waitUntil(promise) {
        backgroundTasks.push(Promise.resolve(promise).catch(() => undefined));
      },
    },
    req: {
      raw: request,
      method: request.method,
      url: request.url,
      param(name) {
        return params[name];
      },
      query(name) {
        return url.searchParams.get(name) ?? undefined;
      },
      header(name) {
        return request.headers.get(name) ?? undefined;
      },
      async json() {
        return request.json();
      },
    },
    header(name, value) {
      responseHeaders.set(name, value);
    },
    json(payload, status = 200) {
      const headers = new Headers(responseHeaders);
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(payload), {status, headers});
    },
  };
}

export async function json(response) {
  return await response.json();
}
