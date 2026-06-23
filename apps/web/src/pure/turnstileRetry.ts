export const TURNSTILE_CLIENT_MAX_ATTEMPTS = 3;
export const TURNSTILE_CLIENT_RETRY_BASE_MS = 400;

export function turnstileClientRetryDelayMs(attempt: number) {
  return TURNSTILE_CLIENT_RETRY_BASE_MS * attempt;
}
