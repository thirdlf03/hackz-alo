import {
  isPolitePeer,
  parseRtcSignal,
  shouldHandleSignal,
  type IceServerConfig,
  type RtcSignalMessage,
} from '../pure/voiceChat.js';
import {addStreamToRecordingMix} from '../game/recording/audioMixer.js';

interface VoicePeer {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  audioElement?: HTMLAudioElement;
  disconnectFromMix?: () => void;
}

export interface VoiceChatManagerOptions {
  localParticipantId: string;
  iceServers: IceServerConfig[];
  sendSignal(message: RtcSignalMessage): Promise<unknown>;
  onPeersChanged(participantIds: string[]): void;
  onError(message: string): void;
}

/**
 * ウォールーム音声のフルメッシュ WebRTC 接続。
 * シグナリングはセッション SSE(`rtc_signal`)+ POST /rtc/signal 経由。
 * offer 衝突は perfect negotiation(participantId 辞書順で polite を決定)で解消。
 * リモート音声は <audio> で再生しつつ、録画ミックスにも合流させて
 * リプレイ動画へ会話を焼き込む。
 */
export class VoiceChatManager {
  private peers = new Map<string, VoicePeer>();
  private localStream: MediaStream | undefined;
  private disconnectLocalFromMix: (() => void) | undefined;
  private muted = false;
  private stopped = false;

  constructor(private options: VoiceChatManagerOptions) {}

  async start(): Promise<void> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {echoCancellation: true, noiseSuppression: true},
    });
    if (this.stopped) {
      this.releaseLocalStream();
      return;
    }
    this.applyMute();
    // マイクをリプレイ録画のミックスへ(スピーカーへは流さない)
    this.disconnectLocalFromMix = addStreamToRecordingMix(this.localStream);
    // 既存参加者へ自分の参加を通知。受け取った側が offer を送ってくる。
    await this.options.sendSignal({
      fromParticipantId: this.options.localParticipantId,
      kind: 'join',
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMute();
  }

  isMuted() {
    return this.muted;
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  handleSignal(data: unknown) {
    const message = parseRtcSignal(data);
    if (
      !message ||
      !shouldHandleSignal(message, this.options.localParticipantId) ||
      this.stopped
    ) {
      return;
    }
    void this.dispatchSignal(message).catch((error: unknown) => {
      console.error('voice signal error', error);
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    void this.options
      .sendSignal({
        fromParticipantId: this.options.localParticipantId,
        kind: 'leave',
      })
      .catch(() => undefined);
    for (const participantId of [...this.peers.keys()]) {
      this.closePeer(participantId);
    }
    this.releaseLocalStream();
    this.disconnectLocalFromMix?.();
    this.disconnectLocalFromMix = undefined;
  }

  private releaseLocalStream() {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }
    this.localStream = undefined;
  }

  private applyMute() {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted;
    }
  }

  private async dispatchSignal(message: RtcSignalMessage) {
    const remoteId = message.fromParticipantId;
    switch (message.kind) {
      case 'join': {
        // 新規参加者に対して既存側から offer を出す。相互 join の glare は
        // perfect negotiation の polite 側 rollback が解消する。
        const peer = this.ensurePeer(remoteId);
        await this.makeOffer(remoteId, peer);
        return;
      }
      case 'leave': {
        this.closePeer(remoteId);
        return;
      }
      case 'offer': {
        await this.handleDescription(
          remoteId,
          message.payload as RTCSessionDescriptionInit
        );
        return;
      }
      case 'answer': {
        await this.handleDescription(
          remoteId,
          message.payload as RTCSessionDescriptionInit
        );
        return;
      }
      case 'ice': {
        const peer = this.peers.get(remoteId);
        if (!peer || message.payload === null) return;
        try {
          await peer.connection.addIceCandidate(
            message.payload as RTCIceCandidateInit
          );
        } catch {
          // rollback 直後などに届いた古い candidate は無視してよい
        }
      }
    }
  }

  private ensurePeer(remoteId: string): VoicePeer {
    const existing = this.peers.get(remoteId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({
      iceServers: this.options.iceServers as RTCIceServer[],
    });
    const peer: VoicePeer = {
      connection,
      polite: isPolitePeer(this.options.localParticipantId, remoteId),
      makingOffer: false,
    };
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      if (this.localStream) connection.addTrack(track, this.localStream);
    }
    connection.addEventListener('icecandidate', (event) => {
      void this.options
        .sendSignal({
          fromParticipantId: this.options.localParticipantId,
          toParticipantId: remoteId,
          kind: 'ice',
          payload: event.candidate?.toJSON() ?? null,
        })
        .catch(() => undefined);
    });
    connection.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.attachRemoteStream(peer, stream);
    });
    connection.addEventListener('negotiationneeded', () => {
      void this.makeOffer(remoteId, peer);
    });
    connection.addEventListener('connectionstatechange', () => {
      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'closed'
      ) {
        this.closePeer(remoteId);
      }
    });
    this.peers.set(remoteId, peer);
    this.notifyPeersChanged();
    return peer;
  }

  private attachRemoteStream(peer: VoicePeer, stream: MediaStream) {
    peer.audioElement?.remove();
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    peer.audioElement = audio;
    void audio.play().catch(() => undefined);
    peer.disconnectFromMix?.();
    // 会話をリプレイ動画へ焼き込む
    peer.disconnectFromMix = addStreamToRecordingMix(stream);
  }

  private async makeOffer(remoteId: string, peer: VoicePeer) {
    if (peer.makingOffer || peer.connection.signalingState !== 'stable') {
      return;
    }
    peer.makingOffer = true;
    try {
      await peer.connection.setLocalDescription();
      await this.options.sendSignal({
        fromParticipantId: this.options.localParticipantId,
        toParticipantId: remoteId,
        kind: 'offer',
        payload: peer.connection.localDescription?.toJSON(),
      });
    } catch (error) {
      console.error('voice offer error', error);
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleDescription(
    remoteId: string,
    description: RTCSessionDescriptionInit | undefined
  ) {
    if (!description || typeof description.type !== 'string') return;
    const peer = this.ensurePeer(remoteId);
    const offerCollision =
      description.type === 'offer' &&
      (peer.makingOffer || peer.connection.signalingState !== 'stable');
    if (offerCollision && !peer.polite) {
      // impolite 側は衝突した相手の offer を無視する(自分の offer が通る)
      return;
    }
    await peer.connection.setRemoteDescription(description);
    if (description.type === 'offer') {
      await peer.connection.setLocalDescription();
      await this.options.sendSignal({
        fromParticipantId: this.options.localParticipantId,
        toParticipantId: remoteId,
        kind: 'answer',
        payload: peer.connection.localDescription?.toJSON(),
      });
    }
  }

  private closePeer(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    this.peers.delete(remoteId);
    peer.disconnectFromMix?.();
    peer.audioElement?.remove();
    if (peer.audioElement) peer.audioElement.srcObject = null;
    try {
      peer.connection.close();
    } catch {
      // already closed
    }
    this.notifyPeersChanged();
  }

  private notifyPeersChanged() {
    this.options.onPeersChanged(this.peerIds());
  }
}
