import type {WorkerContext} from './context.js';

export const securityHeaderValues = {
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
} as const;

export function applySecurityHeaders(headers: Headers) {
  headers.set(
    'Strict-Transport-Security',
    securityHeaderValues.strictTransportSecurity
  );
  headers.set(
    'X-Content-Type-Options',
    securityHeaderValues.xContentTypeOptions
  );
  headers.set('Referrer-Policy', securityHeaderValues.referrerPolicy);
  headers.set('Permissions-Policy', securityHeaderValues.permissionsPolicy);
}

export function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function serveAssetWithSecurityHeaders(
  request: Request,
  assets: Fetcher
) {
  let response = await assets.fetch(request);
  if (
    response.status === 404 &&
    request.method === 'GET' &&
    request.headers.get('Accept')?.includes('text/html')
  ) {
    response = await assets.fetch(new URL('/index.html', request.url));
  }
  return withSecurityHeaders(response);
}

export function securityHeadersMiddleware() {
  return async (c: WorkerContext, next: () => Promise<void>) => {
    await next();
    // DO / asset fetch responses expose immutable Headers; clone before applying.
    c.res = withSecurityHeaders(c.res);
  };
}
