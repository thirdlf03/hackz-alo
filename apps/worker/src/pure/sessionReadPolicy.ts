export type SessionReadDecision =
  | {
      allowed: true;
      reason: 'token';
    }
  | {
      allowed: false;
      reason: 'token_required';
      status: 401;
    };

export function decideSessionReadPolicy(credentials: {
  hasWriteToken?: boolean;
  hasReadToken?: boolean;
}): SessionReadDecision {
  if (credentials.hasWriteToken === true || credentials.hasReadToken === true) {
    return {allowed: true, reason: 'token'};
  }
  return {allowed: false, reason: 'token_required', status: 401};
}
