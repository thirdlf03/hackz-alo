import type {
  GameRenderState,
  RunbookDefinition,
  RunbookStepStatus,
} from '@incident/shared';
import {wrapWords} from './canvasDrawUtils.js';
import {uiFont} from './gamePalette.js';
import {
  extractRunbookPreamble,
  parseRunbookSteps,
  resolveStepStatuses,
} from '../../pure/runbookSteps.js';

/** 手順書パネル本文で使う行送り。既存の全文折り返し表示と同じ値。 */
export const RUNBOOK_BODY_LINE_HEIGHT = 24;
/** 本文の最大幅(既存の全文折り返し表示と同じ値)。 */
export const RUNBOOK_BODY_WIDTH = 470;
/** ステップ行のマーカー分の字下げ幅。 */
export const RUNBOOK_STEP_TEXT_INDENT = 30;
const RUNBOOK_STEP_GAP = 6;
/** クリック当たり判定の矩形を、テキストのベースラインから上下に広げる量。 */
const RUNBOOK_ROW_TOP_PAD = 18;
const RUNBOOK_ROW_BOTTOM_PAD = 6;

export interface RunbookStepRowLayout {
  id: string;
  status: RunbookStepStatus;
  /** 折り返し済みの行(fillText で使う描画済みテキスト)。 */
  lines: string[];
  /** 1行目のベースライン Y 座標。 */
  textY: number;
  /** クリック当たり判定用の矩形の上端 Y 座標。 */
  y: number;
  /** クリック当たり判定用の矩形の高さ。 */
  height: number;
}

export interface RunbookBodyLayout {
  preambleLines: Array<{text: string; y: number}>;
  rows: RunbookStepRowLayout[];
}

/**
 * canvas 手順書タブの描画とクリック当たり判定の双方から呼ばれる、Runbook
 * 本文(前置きテキスト + ステップ一覧)の折り返し・Y座標計算。
 * ctx.measureText のみを使い fillText は呼ばないため、描画時は実際の
 * 描画用 ctx を、クリック判定時は同じ canvas から取得した 2D context を
 * 渡すことで、折り返し位置(=各行のY座標)を両者で確実に一致させつつ、
 * クリック判定側の呼び出しが画面を汚さないようにできる。
 */
export function layoutRunbookBody(
  ctx: CanvasRenderingContext2D,
  runbook: RunbookDefinition,
  progress: GameRenderState['runbookProgress'] | undefined,
  bodyTop: number,
  maxLines: number
): RunbookBodyLayout {
  const steps = parseRunbookSteps(runbook.body, runbook.steps);
  const preamble = extractRunbookPreamble(runbook.body, runbook.steps);
  const resolved = resolveStepStatuses(steps, progress);

  let y = bodyTop;
  let drawnLines = 0;
  const preambleLines: Array<{text: string; y: number}> = [];

  ctx.font = uiFont(17);
  if (preamble) {
    for (const paragraph of preamble.split('\n')) {
      if (drawnLines >= maxLines) break;
      if (!paragraph.trim()) {
        preambleLines.push({text: '', y});
        y += RUNBOOK_BODY_LINE_HEIGHT;
        drawnLines += 1;
        continue;
      }
      for (const line of wrapWords(ctx, paragraph, RUNBOOK_BODY_WIDTH)) {
        if (drawnLines >= maxLines) break;
        preambleLines.push({text: line, y});
        y += RUNBOOK_BODY_LINE_HEIGHT;
        drawnLines += 1;
      }
    }
    if (resolved.length > 0 && drawnLines < maxLines) {
      y += RUNBOOK_STEP_GAP;
    }
  }

  const rows: RunbookStepRowLayout[] = [];
  const textMaxWidth = RUNBOOK_BODY_WIDTH - RUNBOOK_STEP_TEXT_INDENT;
  for (const {step, status} of resolved) {
    if (drawnLines >= maxLines) break;
    ctx.font = status === 'current' ? uiFont(17, 'bold') : uiFont(17);
    const wrapped = wrapWords(ctx, step.instruction, textMaxWidth);
    const available = maxLines - drawnLines;
    const lines = wrapped.slice(0, available);
    if (lines.length === 0) break;

    const textY = y;
    const boxTop = y - RUNBOOK_ROW_TOP_PAD;
    y += lines.length * RUNBOOK_BODY_LINE_HEIGHT;
    drawnLines += lines.length;
    const boxBottom = y - RUNBOOK_BODY_LINE_HEIGHT + RUNBOOK_ROW_BOTTOM_PAD;
    rows.push({
      id: step.id,
      status,
      lines,
      textY,
      y: boxTop,
      height: boxBottom - boxTop,
    });
    y += RUNBOOK_STEP_GAP;
  }

  return {preambleLines, rows};
}
