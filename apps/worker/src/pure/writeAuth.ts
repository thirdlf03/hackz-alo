export function parseBearerToken(
  authorization: string | undefined
): string | undefined {
  if (!authorization) return undefined;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function verifyWriteTokenHash(storedHash: string, tokenHash: string) {
  return (
    storedHash.length === 64 &&
    tokenHash.length === 64 &&
    storedHash === tokenHash
  );
}

export async function hashWriteToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createWriteToken() {
  return (
    crypto.randomUUID().replaceAll('-', '') +
    crypto.randomUUID().replaceAll('-', '')
  );
}
