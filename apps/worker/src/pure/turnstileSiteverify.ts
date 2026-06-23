export function buildTurnstileSiteverifyBody(
  secret: string,
  token: string,
  idempotencyKey: string
) {
  const body = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: idempotencyKey,
  });
  return body;
}

export function readTurnstileSiteverifySuccess(payload: unknown) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    payload.success === true
  );
}

export function readTurnstileSiteverifyErrorCodes(payload: unknown) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error-codes' in payload &&
    Array.isArray(payload['error-codes'])
  ) {
    return payload['error-codes'].filter(
      (code): code is string => typeof code === 'string'
    );
  }
  return undefined;
}
