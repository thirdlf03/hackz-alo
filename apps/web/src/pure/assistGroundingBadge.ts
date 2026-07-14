import type {GroundingResult} from './assistGrounding.js';

export type GroundingBadgeTone = 'ok' | 'repaired' | 'rejected' | 'unverified';

export interface GroundingBadgeInfo {
  tone: GroundingBadgeTone;
  label: string;
  detail?: string;
}

/**
 * Maps a groundAssistNextStep() result to the AI Assist panel's badge
 * text. Returns undefined for 'no_next_step' (no badge shown) and for any
 * other status without a mapped tone.
 */
export function describeGroundingBadge(
  result: GroundingResult
): GroundingBadgeInfo | undefined {
  switch (result.status) {
    case 'ok':
      return {tone: 'ok', label: '✓ 画面の手順と一致'};
    case 'repaired':
      return {
        tone: 'repaired',
        label: '修復済み',
        ...(result.repairedNextStep
          ? {detail: `補完された手順: ${result.repairedNextStep}`}
          : {}),
      };
    case 'rejected':
      return {
        tone: 'rejected',
        label: '⚠ 画面内に確認できないコマンドが含まれています',
      };
    case 'unverified':
      return {
        tone: 'unverified',
        label: '⚠ 画面の手順からは確認できませんでした',
      };
    case 'no_next_step':
      return undefined;
  }
}
