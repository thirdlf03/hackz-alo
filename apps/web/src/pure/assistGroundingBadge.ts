import type {GroundingResult} from './assistGrounding.js';

export type GroundingBadgeTone = 'ok' | 'repaired' | 'rejected' | 'unverified';

export interface GroundingBadgeInfo {
  tone: GroundingBadgeTone;
  label: string;
  detail?: string;
}

/**
 * Shown alongside an 'ok'/'repaired' badge when the matched evidence
 * includes a CHAT line. A chat message is a colleague's remark, not a
 * verified instruction, so even a grounded suggestion sourced from chat is
 * worth cross-checking against other evidence — but chat is not blanket-
 * distrusted here (a legitimate hint can also arrive via chat), so this is
 * a caution, not a rejection.
 */
export const CHAT_SOURCE_CAUTION =
  'チャット由来の提案です。他の証拠と突き合わせてください';

function hasChatSource(sourceLabels: string[] | undefined): boolean {
  return sourceLabels?.includes('CHAT') ?? false;
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
      return {
        tone: 'ok',
        label: '✓ ゲーム内情報で確認',
        ...(hasChatSource(result.sourceLabels)
          ? {detail: CHAT_SOURCE_CAUTION}
          : {}),
      };
    case 'repaired': {
      const repairDetail = result.repairedNextStep
        ? `補完された手順: ${result.repairedNextStep}`
        : undefined;
      const detail = hasChatSource(result.sourceLabels)
        ? [repairDetail, CHAT_SOURCE_CAUTION].filter(Boolean).join(' ')
        : repairDetail;
      return {
        tone: 'repaired',
        label: '修復済み',
        ...(detail ? {detail} : {}),
      };
    }
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
