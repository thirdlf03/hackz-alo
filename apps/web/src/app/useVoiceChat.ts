import {useEffect, useRef, useState} from 'preact/hooks';
import type {ApiClientSurface} from '../api/client.js';
import {VoiceChatManager} from '../effect/voiceChat.js';
import {resumeSharedAudioContext} from '../game/recording/audioMixer.js';
import {parseIceServers, type VoiceChatStatus} from '../pure/voiceChat.js';
import type {Screen} from './appTypes.js';

export interface VoiceChatControls {
  status: VoiceChatStatus;
  muted: boolean;
  peerIds: string[];
  join(): void;
  leave(): void;
  toggleMute(): void;
  /** SSE から届いた rtc_signal を接続中のマネージャへ渡す。 */
  handleSignal(data: unknown): void;
}

/**
 * ウォールーム音声(WebRTC メッシュ + Cloudflare TURN)の参加状態管理。
 * play 画面を離れると自動で退出する。
 */
export function useVoiceChat(options: {
  api: ApiClientSurface;
  screen: Screen;
  session: {sessionId: string} | undefined;
  participantId: string;
}): VoiceChatControls {
  const managerRef = useRef<VoiceChatManager | undefined>(undefined);
  const [status, setStatus] = useState<VoiceChatStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [peerIds, setPeerIds] = useState<string[]>([]);

  const leave = () => {
    managerRef.current?.stop();
    managerRef.current = undefined;
    setStatus('idle');
    setPeerIds([]);
  };

  useEffect(() => {
    if (options.screen === 'play') return;
    leave();
  }, [options.screen]);

  useEffect(() => leave, []);

  const join = () => {
    const session = options.session;
    if (!session || managerRef.current) return;
    const mediaDevices = (navigator as Partial<Navigator>).mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== 'function') {
      setStatus('mic_denied');
      return;
    }
    setStatus('requesting_mic');
    // 参加クリックはユーザー操作なので AudioContext を起こしておく
    resumeSharedAudioContext();
    void (async () => {
      const ice = await options.api
        .getRtcIceServers(session.sessionId)
        .catch(() => undefined);
      const manager = new VoiceChatManager({
        localParticipantId: options.participantId,
        iceServers: parseIceServers(ice),
        sendSignal: (message) =>
          options.api.sendRtcSignal(session.sessionId, message),
        onPeersChanged: (ids) => {
          setPeerIds(ids);
        },
        onError: () => {
          setStatus('error');
        },
      });
      managerRef.current = manager;
      try {
        await manager.start();
        setStatus('connected');
        manager.setMuted(false);
        setMuted(false);
      } catch (error) {
        console.error(error);
        managerRef.current = undefined;
        manager.stop();
        setStatus(
          error instanceof DOMException &&
            (error.name === 'NotAllowedError' || error.name === 'NotFoundError')
            ? 'mic_denied'
            : 'error'
        );
      }
    })();
  };

  const toggleMute = () => {
    const manager = managerRef.current;
    if (!manager) return;
    const next = !manager.isMuted();
    manager.setMuted(next);
    setMuted(next);
  };

  return {
    status,
    muted,
    peerIds,
    join,
    leave,
    toggleMute,
    handleSignal: (data) => managerRef.current?.handleSignal(data),
  };
}
