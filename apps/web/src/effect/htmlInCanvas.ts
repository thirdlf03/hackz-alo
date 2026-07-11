import {supportsDrawElementImage} from '../pure/htmlInCanvas.js';

let cached: boolean | undefined;

/**
 * HTML-in-Canvas(`drawElementImage`)対応をプローブ用 canvas で一度だけ判定し、
 * 結果をキャッシュする。DOM 生成を伴うため effect 層に置く。SSR / 非ブラウザ
 * 環境では false。
 */
export function detectHtmlInCanvasSupport(): boolean {
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') {
    cached = false;
    return cached;
  }
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    cached = ctx ? supportsDrawElementImage(ctx) : false;
  } catch {
    cached = false;
  }
  return cached;
}
