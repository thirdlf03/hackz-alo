/**
 * HTML-in-Canvas API(Chrome 148〜150 Origin Trial)のヘルパー。
 * `<canvas layoutsubtree>` の子孫に置いた本物の DOM を `ctx.drawElementImage()`
 * で canvas に描画しつつ、アクセシビリティ・ヒットテスト・テキスト選択に参加
 * させられる。非対応環境では canvas 自前描画へフォールバックする。
 *
 * 出典: https://developer.chrome.com/blog/html-in-canvas-origin-trial
 */

/**
 * 実行中の 2D コンテキストが `drawElementImage` を持つか判定する。
 * Origin Trial 有効時 / `chrome://flags/#canvas-draw-element` 有効時のみ true。
 */
export function supportsDrawElementImage(ctx: object): boolean {
  return (
    typeof (ctx as {drawElementImage?: unknown}).drawElementImage === 'function'
  );
}

/**
 * `drawElementImage` が返す transform を CSS の `transform` 文字列に正規化する。
 * DOM 上の入力欄の位置を描画位置に重ねてヒットテストを一致させるために使う。
 * 値が無い場合は `'none'` を返し、既存レイアウトを乱さない。
 */
export function transformToCss(transform: unknown): string {
  if (transform === null || transform === undefined) return 'none';
  if (typeof transform === 'string') return transform || 'none';
  const asString = (transform as {toString?: () => string}).toString;
  if (typeof asString === 'function') {
    const value = asString.call(transform);
    return typeof value === 'string' && value.length > 0 ? value : 'none';
  }
  return 'none';
}

/** Origin Trial のトライアル名(index.html のメタタグ用ドキュメント値)。 */
export const HTML_IN_CANVAS_TRIAL = 'HTMLInCanvas';
