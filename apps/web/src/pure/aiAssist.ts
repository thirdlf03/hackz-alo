export type AssistAvailability =
  | 'unsupported'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

export const ASSIST_SNAPSHOT_MAX_WIDTH = 960;
export const ASSIST_SNAPSHOT_MAX_HEIGHT = 540;

export interface CanvasCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasDragRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export const ASSIST_SYSTEM_PROMPT = [
  'あなたはインシデント対応訓練ゲームの相談役です。',
  '画像あり: 最新の添付画像だけを証拠にしてください。画像はゲーム内キャンバスの縮小画像または選択範囲です。外側DOMのTasks（タスク一覧）とIncident Logは見えていません。',
  '画像内で実際に読めるラベル、数値、状態を根拠にしてください。コマンドは文字をそのまま引用し、読めない箇所は推測しないでください。',
  '画像にNEXTまたは復旧手順があれば、確認工程を含むコマンド列を省略せずそのまま次の一手にしてください。ただしそのコマンドがターミナルで実行済みなのに問題が続いている場合は、Runbookではなくチャットの助言や他の画面内の手がかりにあるコマンドを次の一手にしてください。',
  '次の一手のコマンドは、画像に写っている文字列をそのままコピーしてください。画像にないコマンド名を作らないでください(一般知識のコマンド名の捏造は禁止です)。Runbookの注意書きや方針・精神論(例:「再起動しても再発する」)を次の一手にしないでください。',
  'アラートやチャットがRunbookと矛盾する場合(例: integrity check失敗、再起動済みでも未復旧)は、Runbookの記述より画面上の他の証拠を優先してください。',
  '画像なし: 質問文だけを根拠にしてください。具体的な画面状態、数値、固有名詞、コマンドを作らず、一般的な確認項目だけを答えてください。',
  '日本語180文字以内で「次の一手:」「根拠:」の順に答えてください。根拠は最大2点です。質問の解決に必要なコマンドは省略しないでください。前置き、一般論、状況の反復、Markdown見出しは不要です。',
].join('\n');

export function computeSnapshotSize(
  width: number,
  height: number,
  maxWidth = ASSIST_SNAPSHOT_MAX_WIDTH,
  maxHeight = ASSIST_SNAPSHOT_MAX_HEIGHT
): {width: number; height: number} {
  if (width <= 0 || height <= 0) {
    return {width: 1, height: 1};
  }
  if (width <= maxWidth && height <= maxHeight) {
    return {width: Math.round(width), height: Math.round(height)};
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Converts a drag rectangle measured on the CSS-sized canvas into an integer
 * source-pixel rectangle. Reverse drags and points outside the display bounds
 * are normalized before scaling.
 */
export function normalizeCanvasCaptureRect(
  drag: CanvasDragRect,
  display: CanvasSize,
  source: CanvasSize
): CanvasCaptureRect {
  if (
    !isPositiveFinite(display.width) ||
    !isPositiveFinite(display.height) ||
    !isPositiveFinite(source.width) ||
    !isPositiveFinite(source.height)
  ) {
    return {x: 0, y: 0, width: 0, height: 0};
  }

  const displayLeft = clampFinite(
    Math.min(drag.startX, drag.endX),
    0,
    display.width
  );
  const displayTop = clampFinite(
    Math.min(drag.startY, drag.endY),
    0,
    display.height
  );
  const displayRight = clampFinite(
    Math.max(drag.startX, drag.endX),
    0,
    display.width
  );
  const displayBottom = clampFinite(
    Math.max(drag.startY, drag.endY),
    0,
    display.height
  );
  const x = pixelBoundary(
    (displayLeft / display.width) * source.width,
    'floor'
  );
  const y = pixelBoundary(
    (displayTop / display.height) * source.height,
    'floor'
  );
  const right = pixelBoundary(
    (displayRight / display.width) * source.width,
    'ceil'
  );
  const bottom = pixelBoundary(
    (displayBottom / display.height) * source.height,
    'ceil'
  );

  return {
    x,
    y,
    width: Math.max(0, Math.min(source.width, right) - x),
    height: Math.max(0, Math.min(source.height, bottom) - y),
  };
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function clampFinite(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pixelBoundary(value: number, direction: 'floor' | 'ceil') {
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) < 1e-9) return nearest;
  return direction === 'floor' ? Math.floor(value) : Math.ceil(value);
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
      return 'スクリーンショットの添付は任意です';
  }
}

/** Explanatory copy shown in place of the ASSIST panel's null-state when the
 * on-device model isn't (yet) usable — see
 * describeAssistUnavailableNotice(). `hint` is an optional supplementary line
 * (e.g. which browser/version does support the feature). */
export interface AssistUnavailableNotice {
  message: string;
  hint?: string;
}

/**
 * Describes the ASSIST panel's undefined/unsupported/unavailable states for
 * display, replacing the silent empty space AiAssistPanel previously left
 * under the "ASSIST — ソラ (AI)" heading (it returned null in all three
 * cases). Distinct from describeAssistAvailability() above, which renders the
 * short one-line status text used once the panel is otherwise interactive
 * (downloadable/downloading/available) — this covers the states where no
 * interactive panel is shown at all.
 */
export function describeAssistUnavailableNotice(
  availability: AssistAvailability | undefined
): AssistUnavailableNotice {
  switch (availability) {
    case undefined:
      return {message: 'AIの利用可否を確認中…'};
    case 'unsupported':
      return {
        message:
          'このブラウザはオンデバイスAIに対応していません。AIアシストなしでもすべてのシナリオをプレイできます。',
        hint: 'Chrome の内蔵AI(Gemini Nano / Prompt API)に対応したバージョンでは利用できる場合があります。',
      };
    case 'unavailable':
      return {
        message:
          'AIモデルを利用できません(端末の空き容量やフラグ設定をご確認ください)。AIアシストなしでもプレイできます。',
      };
    default:
      // Not expected to be called for downloadable/downloading/available —
      // AiAssistPanel only reaches this path for the three states above.
      return {message: ''};
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
