export const DEFAULT_SHARE_LINK_TTL_HOURS = 168;
export const MAX_SHARE_LINK_TTL_HOURS = 720;
export const SHARE_LINK_SCOPE = 'read' as const;

export class ShareLinkTtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareLinkTtlError';
  }
}

export function normalizeShareLinkTtlHours(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_SHARE_LINK_TTL_HOURS;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShareLinkTtlError('ttlHours must be a finite number');
  }
  const rounded = Math.floor(value);
  if (rounded < 1 || rounded > MAX_SHARE_LINK_TTL_HOURS) {
    throw new ShareLinkTtlError(
      `ttlHours must be between 1 and ${String(MAX_SHARE_LINK_TTL_HOURS)}`
    );
  }
  return rounded;
}

export function shareLinkExpiresAt(nowMs: number, ttlHours: number): string {
  return new Date(nowMs + ttlHours * 3_600_000).toISOString();
}

export function buildReplaySharePath(
  replayId: string,
  readToken: string
): string {
  const params = new URLSearchParams({
    replay: replayId,
    readToken,
  });
  return `/?${params.toString()}`;
}

export function replayVisibilityAfterShare(
  current: string
): 'unlisted' | 'public' {
  return current === 'public' ? 'public' : 'unlisted';
}
