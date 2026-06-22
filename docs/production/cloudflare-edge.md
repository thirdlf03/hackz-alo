# Cloudflare Edge Protection

Apply these settings before public launch.

## WAF

- Enable **OWASP Core Ruleset** for `/api/*`
- Log mode first, then block after false-positive review

## Rate Limiting

| Path                           | Limit              |
| ------------------------------ | ------------------ |
| `POST /api/sessions`           | 5 req/min per IP   |
| `POST /api/replays/*/chunks`   | 120 req/min per IP |
| `POST /api/replays/*/comments` | 10 req/min per IP  |

## Turnstile

1. Create a Turnstile widget in Cloudflare dashboard
2. Set secrets on Worker: `TURNSTILE_SECRET_KEY`, var `TURNSTILE_SITE_KEY` for web build
3. Web sends `turnstileToken` on session create; Worker verifies when secret is configured

## Access (Zero Trust)

- Protect `/api/dev/*` and `/api/admin/*`
- Do **not** put Access on public game `/api/sessions` (anonymous play)

## Transform Rules (response headers)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## Billing alerts

- Configure Cloudflare billing notifications for Workers, R2 egress, and D1 rows read
