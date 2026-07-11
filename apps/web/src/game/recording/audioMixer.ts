/**
 * 録画用オーディオミキサー(tech.md R30-R32)。
 * 共有 AudioContext に MediaStreamDestination をぶら下げ、
 * アラート音とウォールーム音声(マイク・リモート参加者)を
 * canvas 録画の MediaRecorder に合成するための MediaStream を提供する。
 */

let audioContext: AudioContext | undefined;
let recordingDestination: MediaStreamAudioDestinationNode | undefined;

export function getSharedAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

export function resumeSharedAudioContext() {
  const ctx = audioContext;
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/**
 * 録画へ合成する MediaStream。最初の呼び出しで destination を生成する。
 * 入力が何も接続されていない間は無音トラックとして振る舞う。
 */
export function getRecordingAudioStream(): MediaStream | undefined {
  try {
    const ctx = getSharedAudioContext();
    recordingDestination ??= ctx.createMediaStreamDestination();
    return recordingDestination.stream;
  } catch {
    return undefined;
  }
}

/** アラート音などの GainNode を録画ミックスにも接続する。 */
export function connectNodeToRecordingMix(node: AudioNode) {
  if (!recordingDestination) return;
  try {
    node.connect(recordingDestination);
  } catch {
    // 録画ミックスへの接続失敗はゲーム進行に影響させない
  }
}

/**
 * マイクやリモート参加者の MediaStream を録画ミックスへ接続する。
 * スピーカー(ctx.destination)へは接続しない — リモート音声の再生は
 * <audio> 要素側が担い、マイクのローカル再生はエコーになるため。
 * 返り値の関数で切断する。
 */
export function addStreamToRecordingMix(stream: MediaStream): () => void {
  try {
    const ctx = getSharedAudioContext();
    recordingDestination ??= ctx.createMediaStreamDestination();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(recordingDestination);
    return () => {
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    };
  } catch {
    return () => {};
  }
}
