import {logStructured} from '../http/requestLog.js';
import {
  cloudflareTurnEndpoint,
  FALLBACK_ICE_SERVERS,
  parseTurnResponse,
  TURN_CREDENTIAL_TTL_SECONDS,
  type IceServerEntry,
} from '../pure/turnCredentials.js';
import type {Bindings} from '../types.js';

/**
 * Cloudflare Calls TURN サービスから短命クレデンシャルを発行する。
 * 鍵未設定・API 失敗時は Cloudflare STUN のみへフォールバックし、
 * 呼び出し側は常に利用可能な iceServers を受け取る。
 */
export async function generateIceServers(
  env: Bindings
): Promise<IceServerEntry[]> {
  const keyId = env.CF_TURN_KEY_ID;
  const apiToken = env.CF_TURN_KEY_API_TOKEN;
  if (!keyId || !apiToken) return FALLBACK_ICE_SERVERS;
  try {
    const response = await fetch(cloudflareTurnEndpoint(keyId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ttl: TURN_CREDENTIAL_TTL_SECONDS}),
    });
    if (!response.ok) {
      logStructured('turn_credentials_failed', {status: response.status});
      return FALLBACK_ICE_SERVERS;
    }
    const parsed = parseTurnResponse(await response.json());
    if (!parsed) {
      logStructured('turn_credentials_failed', {reason: 'unexpected_body'});
      return FALLBACK_ICE_SERVERS;
    }
    return parsed;
  } catch (error) {
    logStructured('turn_credentials_failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return FALLBACK_ICE_SERVERS;
  }
}
