# 設計書: HTML-in-Canvas API によるキャンバス内リアルDOM UI

- ステータス: 設計(未実装)
- 対象: `apps/web`(ゲーム本体のcanvas描画)
- 前提Chrome: 148〜150(Origin Trial)、`chrome://flags/#canvas-draw-element` でも試験可

## 1. 背景と目的

ゲーム画面は `CanvasRenderer`(`apps/web/src/game/render/canvasRenderer.ts`)が論理解像度 1920x1080 の Canvas 2D に全UIを描画しており、チャット入力・コマンド入力などのテキスト入力も canvas 上の疑似UIとして自前描画している。このため以下の制約がある。

- IME(日本語入力)の変換候補ウィンドウやインライン変換が使えない
- テキスト選択・コピペ・ページ内検索・スクリーンリーダーが効かない
- フォーカスリングなどのアクセシビリティ標準挙動を自前実装する必要がある

HTML-in-Canvas API(Chrome 148〜150 Origin Trial)は、`<canvas layoutsubtree>` の子孫に置いた本物のDOM要素を `ctx.drawElementImage()` で canvas に描画でき、描画後もその要素はアクセシビリティツリー・ヒットテスト・テキスト選択に参加し続ける。これを使い、canvas 内のテキスト入力UIを本物の `<input>`/`<textarea>` に置き換える。

出典:

- https://developer.chrome.com/blog/html-in-canvas-origin-trial
- https://github.com/WICG/html-in-canvas (explainer)

## 2. スコープ

### 第1弾(この設計書の実装範囲)

- **チャット入力欄(chat compose)** を本物の `<input>` にする
  - 現状: `chatComposeRegion` / `chatComposeAt`(`canvasLayout.ts`)の領域に自前描画し、`useCanvasInteraction.ts` の `chat_compose` / `chat_send` アクションで疑似フォーカスを管理している
  - IME が使えないことが最も体験を損ねている箇所であり、置き換え効果が最大

### 第2弾以降(この設計書ではやらない)

- インシデントログ追記フォーム、タスク追加フォーム
- ランブック本文のテキスト選択可能化(`drawRightPanel` 配下)

## 3. API仕様の要点(公式ソース準拠)

| 項目         | 内容                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有効化       | `<canvas layoutsubtree>` 属性。子孫がレイアウト・ヒットテストに参加する                                                                                                         |
| 描画         | `ctx.drawElementImage(element, dx, dy[, dwidth, dheight])` ほか計4オーバーロード                                                                                                |
| 戻り値       | DOM上の位置を描画位置に合わせるための transform。`element.style.transform` に適用する                                                                                           |
| 再描画検知   | canvas の `paint` イベント。「canvas 子要素のレンダリングが変化した場合」に発火(intersection observer ステップ直後)                                                             |
| ヒットテスト | canvas 子要素への CSS transform は描画には無視されるが、ヒットテスト・アクセシビリティには効く。`drawElementImage` の戻り値 transform を適用して DOM 位置と描画位置を一致させる |
| 制限         | クロスオリジン埋め込みコンテンツは描画不可。はみ出しは border box でクリップ。スクロール・アニメーションの反映はJS更新依存                                                      |
| Origin Trial | トライアル名 `HTMLInCanvas`、Chrome 148〜150(151延長予定)、登録: https://developer.chrome.com/origintrials/#/view_trial/3478467762190286849                                     |
| フラグ       | `chrome://flags/#canvas-draw-element`                                                                                                                                           |

## 4. 設計

### 4.1 全体方針: プログレッシブエンハンスメント

`WebMCP`(`effect/webmcp.ts`)や Prompt API(`effect/promptAssistant.ts`)と同じ方針を取る。すなわち **feature detection して使えるときだけ有効化し、非対応環境では現行の canvas 自前描画にそのままフォールバック**する。ゲームのコア体験は API 非対応でも一切変わらない。

```ts
// pure/htmlInCanvas.ts(新規)
export function supportsDrawElementImage(
  ctx: CanvasRenderingContext2D
): boolean {
  return (
    typeof (ctx as {drawElementImage?: unknown}).drawElementImage === 'function'
  );
}
```

### 4.2 DOM構造

`App.tsx` の canvas 要素に `layoutsubtree` を付与し、子として chat compose 用の `<input>` を置く。

```tsx
<canvas ref={canvasRef} layoutsubtree tabIndex={0}>
  {htmlInCanvasSupported && (
    <input
      ref={chatInputRef}
      class='canvas-embedded-chat-input'
      aria-label='チャットメッセージ'
      maxLength={500}
    />
  )}
</canvas>
```

- 非対応ブラウザでは canvas の子はフォールバックコンテンツとして非表示になるだけなので、条件レンダリング(`htmlInCanvasSupported`)は安全側の保険
- スタイルは既存デザイントークン(CSS変数)を参照し、canvas 自前描画版の見た目(`gamePalette.ts`)と揃える

### 4.3 CanvasRenderer への組み込み

`CanvasRenderer.draw()`(`canvasRenderer.ts:132`)の描画パスに1ステップ追加する。

1. コンストラクタで `supportsDrawElementImage(ctx)` を判定し `htmlInCanvasEnabled` を保持
2. `draw()` の `drawInputDock` / チャット描画の直後に、有効時のみ `drawEmbeddedElements()` を呼ぶ:

```ts
private drawEmbeddedElements() {
  if (!this.htmlInCanvasEnabled || !this.chatInput) return;
  const region = chatComposeRegion(); // canvasLayout.ts の既存領域
  const transform = this.ctx.drawElementImage(
    this.chatInput, region.x, region.y, region.width, region.height
  );
  // ヒットテスト位置合わせ: DOM上の入力欄を描画位置に重ねる
  this.chatInput.style.transform = transform.toString();
}
```

3. **transform の再適用タイミング**: `draw()` は `ctx.setTransform` で論理座標→物理座標のスケーリングをかけているため(`canvasRenderer.ts:140`)、`drawElementImage` はこの transform 内で呼ぶ。canvas の CSS サイズ変更(リサイズ)時は次フレームの `draw()` で自然に追従する
4. **`paint` イベント**: IME 変換中の表示更新など「DOM 側だけが変化した」ケースを拾うため、canvas に `paint` リスナーを張り、ゲームループ外でも再描画を要求する:

```ts
canvas.addEventListener('paint', () => {
  if (this.lastRendered) {
    this.draw(this.lastRendered.state, this.lastRendered.scenario);
  }
});
```

既存の `lastRendered` 再描画機構(`scrollMetricsPanel` と同じパターン)をそのまま使う。

### 4.4 入力イベントとフォーカス管理

現状の `useCanvasInteraction.ts` は canvas 座標のヒットテスト(`resolveCanvasAction`)で `chat_compose` / `chat_send` を判定している。HTML-in-Canvas 有効時は次のように整理する。

- **クリック**: transform 適用済みの `<input>` が canvas 上のその位置に実在するため、クリックは通常の DOM イベントとして input に直接届く。`resolveCanvasAction` の `chat_compose` 分岐は「input へ `focus()` を移す」だけの薄い処理に変える(疑似フォーカス状態 `activateChatCompose` は不要になるが、非対応環境のフォールバックとして残す)
- **確定(Enter)**: input の `keydown` で Enter を拾い、既存の `submitChatMessage()` を呼ぶ。送信ボタン(`chatSendButtonRegion`)のクリックは従来通り canvas アクション経由
- **コマンド入力ドックとの排他**: 既存の `focusCommandInput` / `blurCommandInput`(`gameState.ts`)との排他は、input の `focus`/`blur` イベントで `patchGameStateRef` を呼んで同期する

### 4.5 リプレイ録画との関係

リプレイ動画は canvas をキャプチャするため(`useCanvasRecording.ts`)、`drawElementImage` で canvas に描かれた入力欄は**録画にそのまま含まれる**。追加対応は不要。ただし入力中テキストが録画に残る点は現行の自前描画と同等であり、新たなプライバシー影響はない。

### 4.6 Origin Trial の配布設定

- `apps/web/index.html` に `<meta http-equiv="origin-trial" content="...">` でトークンを埋め込む(本番オリジン用)
- ローカル開発は `chrome://flags/#canvas-draw-element` を有効化して確認する
- トークンは環境ごとに異なるため、Vite の `import.meta.env` 経由ではなく index.html 直書き + デプロイ環境のドキュメント(`docs/production/`)に手順を追記する

## 5. ロール権限

チャット送信は現状全ロールに開放されている(`rolePermissions.ts` のゲート対象はターミナル操作 `canOperateSandbox` と記録系 `canContributeRecords` のみ)。本設計は入力UIの実装差し替えであり、権限モデルは変更しない。

## 6. テスト計画

- 単体: `supportsDrawElementImage` の feature detection(モック ctx)
- 単体: HTML-in-Canvas 無効時に従来の `chat_compose` アクション経路が変化しないこと(既存テストの回帰)
- E2E(Playwright): フラグ付き Chrome(`--enable-features=CanvasDrawElement` 相当)で、(1) チャット入力欄クリック→タイプ→Enter送信、(2) 日本語IME入力はPlaywrightで再現困難なため手動確認項目とする
- 手動: スクリーンリーダー(VoiceOver)で input が読み上げられること、ページ内検索・テキスト選択

## 7. リスクと判断

| リスク                                                                   | 対応                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Origin Trial が 150 で終了する(151 延長予定はあるが未確定)               | プログレッシブエンハンスメント設計により、OT終了後も自動でフォールバックに戻るだけでゲームは壊れない                          |
| API shape が OT 中に変わる(chromestatus のステータスは "In development") | `drawElementImage` の呼び出しと feature detection を `CanvasRenderer` 内の1メソッド+1ヘルパーに閉じ込め、変更影響を局所化する |
| `paint` イベント発火頻度が高くフルリドローがコスト過大になる             | 既存の静的レイヤーキャッシュ(`staticCanvas`)がある。問題になれば `paint` 起点の再描画を rAF で間引く                          |
| Firefox / Safari 非対応                                                  | フォールバックで従来体験。機能はChrome向けのデモ差別化と割り切る                                                              |

## 8. 実装タスク分解

1. `pure/htmlInCanvas.ts`: feature detection(テスト含む)
2. `App.tsx`: `layoutsubtree` 属性と embedded input のレンダリング
3. `CanvasRenderer`: `drawEmbeddedElements` + `paint` リスナー
4. `useCanvasInteraction.ts`: chat compose 分岐のフォーカス移譲
5. `index.html`: Origin Trial メタタグ(トークンはデプロイ時に発行)
6. E2E + 手動確認、`docs/production/` に OT 運用手順を追記
