export const TURNSTILE_VERIFICATION_FAILED = 'turnstile verification failed';

export function isTurnstileVerificationError(message: string) {
  return message === TURNSTILE_VERIFICATION_FAILED;
}

export function shouldRetryCreateSessionAfterTurnstileFailure(
  turnstileEnabled: boolean,
  message: string
) {
  return turnstileEnabled && isTurnstileVerificationError(message);
}
