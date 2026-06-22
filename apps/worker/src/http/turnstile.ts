import type {Bindings} from '../types.js';
import {logStructured} from './requestLog.js';

export async function verifyTurnstileToken(
  env: Bindings,
  token: string | undefined,
  remoteIp?: string
) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || token.trim().length === 0) {
    logStructured('turnstile_verify_failed', {reason: 'missing_token'});
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  const trimmedIp = remoteIp?.trim();
  if (trimmedIp && trimmedIp.length > 0) {
    body.set('remoteip', trimmedIp);
  }
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
    }
  );
  if (!response.ok) {
    logStructured('turnstile_verify_failed', {
      reason: 'siteverify_http_error',
      status: response.status,
    });
    return false;
  }
  const payload: unknown = await response.json();
  const success =
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    payload.success === true;
  if (!success) {
    const errorCodes =
      typeof payload === 'object' &&
      payload !== null &&
      'error-codes' in payload &&
      Array.isArray(payload['error-codes'])
        ? payload['error-codes']
        : undefined;
    logStructured('turnstile_verify_failed', {
      reason: 'siteverify_rejected',
      errorCodes,
    });
  }
  return success;
}
