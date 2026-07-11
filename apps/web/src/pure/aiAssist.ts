export type AssistAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export const ASSIST_SNAPSHOT_MAX_WIDTH = 1024;

export const ASSIST_SYSTEM_PROMPT = [
  'あなたはインシデント対応訓練ゲームの相談役です。',
  '添付されるのはプレイヤーのゲーム画面(監視ダッシュボード、トポロジー図、ターミナル、タスク一覧など)のスクリーンショットです。',
  '画面から読み取れる事実を根拠に、障害対応の次の一手を短く日本語で助言してください。',
  '答えを断定できないときは、画面のどこを確認すべきかを提案してください。',
].join('\n');

export function computeSnapshotSize(
  width: number,
  height: number,
  maxWidth = ASSIST_SNAPSHOT_MAX_WIDTH
): {width: number; height: number} {
  if (width <= 0 || height <= 0) {
    return {width: 1, height: 1};
  }
  if (width <= maxWidth) {
    return {width: Math.round(width), height: Math.round(height)};
  }
  const scale = maxWidth / width;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function buildAssistPrompt(question: string): string | undefined {
  const trimmed = question.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

export function describeAssistAvailability(
  availability: AssistAvailability
): string {
  switch (availability) {
    case 'unsupported':
      return 'このブラウザはオンデバイスAIに対応していません';
    case 'unavailable':
      return 'この端末ではオンデバイスAIを利用できません';
    case 'downloadable':
      return 'AIモデルをダウンロードすると利用できます';
    case 'downloading':
      return 'AIモデルをダウンロードしています…';
    case 'available':
      return '画面のスクリーンショットを添えて質問できます';
  }
}

export function formatDownloadProgress(loaded: number): string {
  const ratio = Number.isFinite(loaded) ? Math.min(Math.max(loaded, 0), 1) : 0;
  return `${String(Math.round(ratio * 100))}%`;
}
