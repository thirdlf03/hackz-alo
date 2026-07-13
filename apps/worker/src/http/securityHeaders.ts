import type {WorkerContext} from './context.js';

// Content-Security-Policy for HTML (document) responses only — API/JSON
// responses have no script/style/frame surface to protect and CSP has no
// effect on them. Every non-'self' source below is grepped evidence from
// apps/web/src, not guesswork:
//   - script-src/connect-src/frame-src https://challenges.cloudflare.com:
//     the Turnstile widget script is loaded from that exact URL
//     (apps/web/src/effect/turnstileClient.ts) and Cloudflare requires
//     fetching it unproxied from that origin; the widget also opens a
//     challenge iframe and makes XHR calls back to challenges.cloudflare.com.
//   - img-src data:: apps/web/src/effect/promptAssistant.ts renders an
//     AI-assist screenshot preview via canvas.toDataURL(), shown through
//     an <img src> data: URL (apps/web/src/app/AiAssistPanel.tsx).
//   - media-src blob:: replay video playback uses
//     URL.createObjectURL(blob) for the <video> src
//     (apps/web/src/pages/ReplayPage.tsx).
// No inline <script>/<style> or javascript: URLs were found (apps/web
// ships only a same-origin module script and imported .css files), so
// script-src/style-src carry no 'unsafe-inline'.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export const securityHeaderValues = {
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
  contentSecurityPolicy,
} as const;

export function applySecurityHeaders(headers: Headers, isHtml = false) {
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
  if (isHtml) {
    headers.set(
      'Content-Security-Policy',
      securityHeaderValues.contentSecurityPolicy
    );
  }
}

function isHtmlResponse(headers: Headers) {
  return (headers.get('content-type') ?? '').includes('text/html');
}

export function withSecurityHeaders(response: Response) {
  // WebSocket upgrades return 101; cloning throws outside 200–599 in Workers.
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, isHtmlResponse(headers));
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
