const JAPAN_SESSION_LOCATION_HINT = 'apac-ne' as const;

export function getSessionDoStub(
  namespace: DurableObjectNamespace,
  sessionId: string
) {
  return namespace.get(namespace.idFromName(sessionId), {
    locationHint: JAPAN_SESSION_LOCATION_HINT,
  });
}
