import type {Bindings} from '../types.js';
import {
  buildTurnstileSiteverifyBody,
  readTurnstileSiteverifyErrorCodes,
  readTurnstileSiteverifySuccess,
} from '../pure/turnstileSiteverify.js';
import {logStructured} from './requestLog.js';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(
  env: Bindings,
  token: string | undefined,
  _remoteIp?: string
) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || token.trim().length === 0) {
    logStructured('turnstile_verify_failed', {reason: 'missing_token'});
    return false;
  }

  const idempotencyKey = crypto.randomUUID();
  const body = buildTurnstileSiteverifyBody(secret, token, idempotencyKey);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body,
      });
      if (!response.ok) {
        logStructured('turnstile_verify_failed', {
          reason: 'siteverify_http_error',
          status: response.status,
          attempt,
        });
        if (attempt < 2) continue;
        return false;
      }
      const payload: unknown = await response.json();
      const success = readTurnstileSiteverifySuccess(payload);
      if (success) return true;

      const errorCodes = readTurnstileSiteverifyErrorCodes(payload);
      const retryable =
        errorCodes?.includes('internal-error') ||
        errorCodes?.includes('bad-request');
      logStructured('turnstile_verify_failed', {
        reason: 'siteverify_rejected',
        errorCodes,
        attempt,
      });
      if (retryable && attempt < 2) continue;
      return false;
    } catch (error: unknown) {
      logStructured('turnstile_verify_failed', {
        reason: 'siteverify_fetch_error',
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      if (attempt < 2) continue;
      return false;
    }
  }

  return false;
}
