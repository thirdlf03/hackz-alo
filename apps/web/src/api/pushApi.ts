import type {ApiResult} from '@incident/shared';

export interface PagerSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {p256dh: string; auth: string};
}

export async function fetchPushPublicKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/push/public-key');
    if (!response.ok) return null;
    const payload: ApiResult<{publicKey: string | null}> =
      await response.json();
    if (!payload.ok) return null;
    return payload.data.publicKey;
  } catch {
    return null;
  }
}

export async function registerPagerSubscription(
  sessionId: string,
  writeToken: string | undefined,
  subscription: PagerSubscriptionPayload
): Promise<void> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (writeToken) {
    headers.authorization = `Bearer ${writeToken}`;
  }
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/pager`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(subscription),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to register pager subscription: ${String(response.status)}`
    );
  }
}
