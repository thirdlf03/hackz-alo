export type AssistAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export const ASSIST_SNAPSHOT_MAX_WIDTH = 1920;

export const ASSIST_SYSTEM_PROMPT = [
  'あなたはインシデント対応訓練ゲームの相談役です。',
  '最新の添付画像だけを現在の画面状態を示す証拠として扱ってください。画像は1920x1080のゲーム内キャンバスだけで、監視メトリクス、トポロジー、ターミナル、ランブック、ゲーム内チャットが表示されます。',
  'ゲーム画面の外側のDOMにあるTasks（タスク一覧）とIncident Logは添付画像に含まれません。見えているものとして言及しないでください。',
  '回答では、画像内で実際に見えるラベル、数値、ステータス、コマンドやメッセージを具体的な根拠として示し、障害対応の次の一手を短く日本語で助言してください。',
  '文字や領域が読めない場合は推測で補わず、読めないことを明示して、画像内のどこを確認すべきか提案してください。',
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

export function clampDownloadRatio(loaded: number): number {
  return Number.isFinite(loaded) ? Math.min(Math.max(loaded, 0), 1) : 0;
}

export function progressEventRatio(event: {
  loaded?: number;
  total?: number;
}): number | undefined {
  const loaded = event.loaded;
  if (loaded === undefined || !Number.isFinite(loaded)) return undefined;
  const total = event.total;
  if (total !== undefined && Number.isFinite(total) && total > 1) {
    return clampDownloadRatio(loaded / total);
  }
  return clampDownloadRatio(loaded);
}

export function formatDownloadProgress(loaded: number): string {
  const ratio = clampDownloadRatio(loaded);
  return `${String(Math.round(ratio * 100))}%`;
}

export function describeModelDownloadStatus(
  availability: AssistAvailability,
  downloadProgress?: number
): string {
  switch (availability) {
    case 'available':
      return 'AIモデルはダウンロード済みです';
    case 'downloading':
      if (downloadProgress === undefined || downloadProgress <= 0) {
        return 'AIモデルをダウンロードしています…';
      }
      if (downloadProgress >= 1) {
        return 'AIモデルを準備しています…';
      }
      return `AIモデルをダウンロードしています… ${formatDownloadProgress(downloadProgress)}`;
    case 'downloadable':
      return 'プレイ中のAI Assistで使うAIモデルを、端末内で事前にダウンロードできます。';
    default:
      return '';
  }
}
