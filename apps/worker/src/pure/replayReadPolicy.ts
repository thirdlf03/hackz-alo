import type {ReplayVisibility} from '@incident/shared';

export type ReplayReadDecision =
  | {
      allowed: true;
      includePrivateEvents: boolean;
      reason: 'public' | 'token';
    }
  | {
      allowed: false;
      includePrivateEvents: false;
      reason: 'token_required';
      status: 401;
    };

export function normalizeReplayVisibility(value: unknown): ReplayVisibility {
  if (value === 'private' || value === 'unlisted' || value === 'public') {
    return value;
  }
  return 'private';
}

export function decideReplayReadPolicy(
  visibility: unknown,
  credentials: {hasWriteToken?: boolean; hasReadToken?: boolean} = {}
): ReplayReadDecision {
  const normalized = normalizeReplayVisibility(visibility);
  const hasReadCredential =
    credentials.hasWriteToken === true || credentials.hasReadToken === true;

  if (normalized === 'public') {
    return {
      allowed: true,
      includePrivateEvents: hasReadCredential,
      reason: hasReadCredential ? 'token' : 'public',
    };
  }

  if (hasReadCredential) {
    return {allowed: true, includePrivateEvents: true, reason: 'token'};
  }

  return {
    allowed: false,
    includePrivateEvents: false,
    reason: 'token_required',
    status: 401,
  };
}
