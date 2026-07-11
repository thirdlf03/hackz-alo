/**
 * 録画用オーディオミキサー(tech.md R30-R32)。
 * 共有 AudioContext に MediaStreamDestination をぶら下げ、
 * アラート音とウォールーム音声(マイク・リモート参加者)を
 * canvas 録画の MediaRecorder に合成するための MediaStream を提供する。
 */

let audioContext: AudioContext | undefined;
let recordingDestination: MediaStreamAudioDestinationNode | undefined;
let recordingKeepAliveOscillator: OscillatorNode | undefined;

export function getSharedAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

/**
 * user gesture 内で生成された AudioContext は Chrome では 'running' で
 * 始まるため、gesture のコールスタック内から呼ぶこの関数で生成まで行う。
 */
export function resumeSharedAudioContext() {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

/**
 * suspended な AudioContext の MediaStreamDestination トラックは無音停止し
 * MediaRecorder 全体をストールさせるため、running のときだけ合成対象にする。
 */
export function canMixRecordingAudio(state: AudioContextState): boolean {
  return state === 'running';
}

/**
 * Chrome は MediaStreamDestination に実ソースが無いと audio track が
 * "silent but unmuted" になり、MediaRecorder が dataavailable を出さなくなる。
 * gain=0 の oscillator を常時接続してトラックを生かし続ける。
 */
function ensureRecordingDestination(ctx: AudioContext) {
  recordingDestination ??= ctx.createMediaStreamDestination();
  if (recordingKeepAliveOscillator) return recordingDestination;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const oscillator = ctx.createOscillator();
  oscillator.connect(gain);
  gain.connect(recordingDestination);
  oscillator.start();
  recordingKeepAliveOscillator = oscillator;
  return recordingDestination;
}

/**
 * 録画へ合成する MediaStream。最初の呼び出しで destination を生成する。
 * AudioContext が running でない場合は undefined を返し、resume を試みる
 * (録画は映像のみで開始される)。
 */
export function getRecordingAudioStream(): MediaStream | undefined {
  try {
    const ctx = getSharedAudioContext();
    if (!canMixRecordingAudio(ctx.state)) {
      if (ctx.state === 'suspended') void ctx.resume();
      return undefined;
    }
    return ensureRecordingDestination(ctx).stream;
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
    const destination = ensureRecordingDestination(ctx);
    const source = ctx.createMediaStreamSource(stream);
    source.connect(destination);
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
