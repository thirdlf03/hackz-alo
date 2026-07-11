import type {AlertDefinition} from '@incident/shared';
import {
  connectNodeToRecordingMix,
  getSharedAudioContext,
} from './audioMixer.js';

function beep(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  durationSec: number,
  volume = 0.12
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  // アラート音もリプレイに残す(tech.md R30-R32): 録画ミックスにも分岐する
  connectNodeToRecordingMix(gain);
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

export function playAlertBeep(
  severity: AlertDefinition['severity'] = 'warning'
) {
  try {
    const ctx = getSharedAudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const frequency =
      severity === 'critical' ? 880 : severity === 'warning' ? 660 : 520;
    beep(ctx, frequency, now, 0.22);
    if (severity === 'critical') beep(ctx, frequency, now + 0.32, 0.22);
  } catch {
    // Web Audio unavailable
  }
}
