# tech: Frontend 設計

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 3. Frontend 設計

### 3.1 画面構成

MVP の画面は次の 4 layer に分ける。

1. `gameCanvas`: 録画対象。トリプルモニター、terminal 表示、metrics、Runbook、チャット風通知、cursor、click effect、REC overlay、game clock を描画する。
2. `inputLayer`: キーボード入力、pointer event、focus 管理を受ける透明 DOM layer。
3. `assistiveDom`: スクリーンリーダーや copy/paste 用の補助 DOM。録画には入らない。
4. `debugDom`: 開発中のみ使う。production では off。

重要: DOM にしか存在しない情報は replay 動画に残らない。録画対象に含めたい情報は必ず `GameRenderState` に入れて canvas renderer が描画する。

```ts
type GameRenderState = {
  session: SessionHeader;
  clock: GameClock;
  monitors: {
    left: MetricsPanelState;
    center: TerminalPanelState;
    right: InfoPanelState;
  };
  alerts: AlertState[];
  cursor: CursorState;
  clickEffects: ClickEffect[];
  recording: RecordingOverlayState;
};
```

### 3.2 Preact の使いどころ

Preact は canvas の外側、つまり app shell、routing、modal、settings、result/replay page の DOM UI を担当する。Preact は React の完全再実装ではなく差分があるが、`preact/compat` で React ecosystem 互換を広げられる [R19]。TypeScript の JSX 設定も公式に整理されている [R20]。

MVP では以下を推奨する。

```txt
src/
  app/
    App.tsx
    routes.tsx
  game/
    state/
    render/
    recording/
    terminal/
    scenario/
  api/
  replay/
  styles/
```

### 3.3 Canvas renderer

canvas は固定 logical resolution を持つ。

推奨:

```txt
logicalWidth: 1920
logicalHeight: 1080
captureFps: 30
devicePixelRatio: min(window.devicePixelRatio, 2)
```

描画は `requestAnimationFrame` で行い、シナリオ時刻や metrics は state update として別管理する。録画フレームレートは `canvas.captureStream(30)` で指定する [R25]。

MDN の canvas optimization に従い、以下を守る [R29]。

- 静的背景は offscreen buffer に描画して使い回す。
- 毎 frame で text measure を大量に呼ばない。
- dirty region を分ける。ただし MVP は 1920x1080 全面 redraw でもまず計測して判断する。
- 画像 asset は事前 decode する。
- cross-origin 画像を canvas に描く場合は CORS を正しく設定する。

特に重要なのは origin-clean。canvas に CORS 不備の外部画像を描くと、canvas の bitmap が origin-clean でなくなり、`captureStream()` が `SecurityError` を投げる可能性がある [R25]。画像・フォント・動画 asset は same-origin か、R2 public bucket / signed URL に CORS header を付け、`crossOrigin="anonymous"` で読み込む。

### 3.4 Terminal UI

要件では xterm.js が候補にある。xterm.js は `onData` で入力を取得し、`write` で出力を書き込み、buffer にもアクセスできる [R24]。Cloudflare Sandbox は browser terminal と sandbox shell を WebSocket で接続する `terminal()` と xterm 用 `SandboxAddon` を提供する [R3]。

ただし、xterm.js の DOM 表示だけでは canvas 録画に入らない。MVP は次の構成にする。

```txt
User input
  -> xterm.js / input adapter
  -> WebSocket
  -> Sandbox terminal
  -> output
  -> xterm.js buffer
  -> TerminalMirrorState
  -> gameCanvas drawTerminal()
```

`TerminalMirrorState` は以下を持つ。

```ts
type TerminalMirrorState = {
  cols: number;
  rows: number;
  lines: TerminalCellLine[];
  cursor: {x: number; y: number; visible: boolean};
  title?: string;
  commandDraft: string;
  commandHistory: CommandEvent[];
};
```

ANSI escape sequence の完全再現は難しい。MVP では以下の表現を保証する。

- printable text
- newline
- cursor position
- basic 16 colors
- bold / dim
- clear screen
- terminal prompt

full-screen editor (`vim`, `nano`, `top`) は MVP では「使えるが録画 mirror の再現は best effort」とする。訓練として必要な編集は `cat`, `sed`, `tail`, `rm`, `systemctl` 風コマンド、または Web editor panel で成立させる。

### 3.5 入力イベントと event log

ユーザー操作は UI state 更新と event log 追記を同時に行う。

```ts
emitEvent({
  type: 'terminal_input',
  at: gameTimeMs,
  data: typedText,
  redaction: 'none',
});
```

terminal input は replay 公開時に個人情報になり得る。MVP では実 sandbox に secrets を入れず、入力内容は基本保存する。将来、ユーザー自由入力が増えたら redaction policy を導入する。
