/** WebRTC ウォールーム音声のシグナリングと状態の純粋ロジック。 */

export type RtcSignalKind = 'join' | 'offer' | 'answer' | 'ice' | 'leave';

export interface RtcSignalMessage {
  fromParticipantId: string;
  /** 省略時は全員宛(join/leave のブロードキャスト)。 */
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

export function parseRtcSignal(data: unknown): RtcSignalMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  const from = record['fromParticipantId'];
  const kind = SIGNAL_KINDS.find((value) => value === record['kind']);
  if (typeof from !== 'string' || from === '' || !kind) return undefined;
  const to = record['toParticipantId'];
  return {
    fromParticipantId: from,
    kind,
    ...(typeof to === 'string' && to !== '' ? {toParticipantId: to} : {}),
    ...('payload' in record ? {payload: record['payload']} : {}),
  };
}

/** 自分が処理すべきシグナルか(自分発でなく、宛先が自分または全員)。 */
export function shouldHandleSignal(
  message: RtcSignalMessage,
  localParticipantId: string
): boolean {
  if (message.fromParticipantId === localParticipantId) return false;
  return (
    message.toParticipantId === undefined ||
    message.toParticipantId === localParticipantId
  );
}

/**
 * Perfect negotiation の polite 側を参加者IDの辞書順で決める。
 * 双方が同時に offer を出した場合、polite 側が rollback して譲る。
 */
export function isPolitePeer(
  localParticipantId: string,
  remoteParticipantId: string
): boolean {
  return localParticipantId < remoteParticipantId;
}

export type VoiceChatStatus =
  | 'idle'
  | 'requesting_mic'
  | 'connecting'
  | 'connected'
  | 'mic_denied'
  | 'error';

export function describeVoiceStatus(
  status: VoiceChatStatus,
  peerCount: number,
  muted: boolean
): string {
  switch (status) {
    case 'idle':
      return '未参加';
    case 'requesting_mic':
      return 'マイクの許可を待っています…';
    case 'connecting':
      return '接続中…';
    case 'connected': {
      const peers =
        peerCount > 0 ? `${String(peerCount)}人と通話中` : '参加者を待機中';
      return muted ? `${peers}(ミュート中)` : peers;
    }
    case 'mic_denied':
      return 'マイクを利用できません(ブラウザの許可を確認してください)';
    case 'error':
      return '音声接続でエラーが発生しました';
  }
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** TURN 未設定環境向けのフォールバック(Cloudflare STUN)。 */
export const FALLBACK_ICE_SERVERS: IceServerConfig[] = [
  {urls: 'stun:stun.cloudflare.com:3478'},
];

export function parseIceServers(data: unknown): IceServerConfig[] {
  if (typeof data !== 'object' || data === null) return FALLBACK_ICE_SERVERS;
  const list = (data as {iceServers?: unknown}).iceServers;
  if (!Array.isArray(list)) return FALLBACK_ICE_SERVERS;
  const servers = list.filter((entry): entry is IceServerConfig => {
    if (typeof entry !== 'object' || entry === null) return false;
    const urls = (entry as {urls?: unknown}).urls;
    return (
      typeof urls === 'string' ||
      (Array.isArray(urls) && urls.every((url) => typeof url === 'string'))
    );
  });
  return servers.length > 0 ? servers : FALLBACK_ICE_SERVERS;
}
