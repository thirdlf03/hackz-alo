/** Cloudflare Calls TURN サービスのクレデンシャル生成まわりの純粋ロジック。 */

export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** TURN 鍵が未設定の環境向けフォールバック(Cloudflare の公開 STUN)。 */
export const FALLBACK_ICE_SERVERS: IceServerEntry[] = [
  {urls: 'stun:stun.cloudflare.com:3478'},
];

export const TURN_CREDENTIAL_TTL_SECONDS = 3600;

export function cloudflareTurnEndpoint(turnKeyId: string): string {
  return `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`;
}

/**
 * Cloudflare TURN API のレスポンスから iceServers を取り出す。
 * 想定外の形なら undefined(呼び出し側が STUN にフォールバックする)。
 */
export function parseTurnResponse(data: unknown): IceServerEntry[] | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const list = (data as {iceServers?: unknown}).iceServers;
  const entries = Array.isArray(list) ? list : [list];
  const servers = entries.filter((entry): entry is IceServerEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const urls = (entry as {urls?: unknown}).urls;
    return (
      typeof urls === 'string' ||
      (Array.isArray(urls) && urls.every((url) => typeof url === 'string'))
    );
  });
  return servers.length > 0 ? servers : undefined;
}

export type RtcSignalKind = 'join' | 'offer' | 'answer' | 'ice' | 'leave';

export interface RtcSignalBody {
  fromParticipantId: string;
  toParticipantId?: string;
  kind: RtcSignalKind;
  payload?: unknown;
}

const SIGNAL_KINDS: RtcSignalKind[] = [
  'join',
  'offer',
  'answer',
  'ice',
  'leave',
];

/** シグナリング中継ボディの検証。SDP を含むので上限は呼び出し側で制御する。 */
export function parseRtcSignalBody(body: unknown): RtcSignalBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const from = record['fromParticipantId'];
  const kind = SIGNAL_KINDS.find((value) => value === record['kind']);
  if (typeof from !== 'string' || from === '' || from.length > 100 || !kind) {
    return undefined;
  }
  const to = record['toParticipantId'];
  if (to !== undefined && (typeof to !== 'string' || to.length > 100)) {
    return undefined;
  }
  return {
    fromParticipantId: from,
    kind,
    ...(typeof to === 'string' && to !== '' ? {toParticipantId: to} : {}),
    ...('payload' in record ? {payload: record['payload']} : {}),
  };
}
