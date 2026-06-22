import type {Bindings} from '../types.js';

export async function verifyTurnstileToken(
  env: Bindings,
  token: string | undefined
) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || token.trim().length === 0) return false;

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
    }
  );
  if (!response.ok) return false;
  const payload: unknown = await response.json();
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    payload.success === true
  );
}
