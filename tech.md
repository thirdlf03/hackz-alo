# 障害対応訓練シミュレーション 技術調査・設計書

調査日: 2026-06-20  
対象要件: [youken.md](./youken.md)  
目的: 要件定義に出てくる技術要素を、実装時に迷わない粒度まで分解する。

## 0. 結論

MVP は Cloudflare Workers + Hono + Durable Objects + D1 + R2 + Cloudflare Sandbox を中心に組む。フロントエンドは Preact + TypeScript + Vite、ターミナルは xterm.js、録画は `HTMLCanvasElement.captureStream()` + `MediaRecorder` を使う。

最も重要な設計判断は、「操作 UI」と「録画 UI」を分離しないこと。要件では録画対象を canvas 内に限定しているため、ユーザーが見ているゲーム画面の主要情報は必ず canvas に描画されている必要がある。xterm.js や Runbook などの DOM UI をそのまま置くだけでは録画に入らない。したがって MVP では、DOM は入力・アクセシビリティ・補助 UI に限定し、録画用 `gameCanvas` が最終的な画面表現を持つ。xterm.js の表示内容も、terminal buffer / 入出力イベントから canvas に再描画する。根拠は canvas capture が canvas の内容だけを MediaStream 化する仕様であること [R25]、xterm.js が terminal buffer と render/update event を提供すること [R24]。

録画保存は 2 層にする。5 秒ごとの `MediaRecorder` chunk は復旧用・partial replay 用に R2 へ chunk object として保存する。一方、結果画面で通常再生する最終動画は R2 multipart upload で 1 つの `video.webm` にまとめる。R2 multipart は各 part のサイズ制約があるため、MediaRecorder の 5 秒 chunk をそのまま multipart part として扱わず、ブラウザ側で固定サイズ byte part に再構成して upload する [R10][R11]。

リアルタイム状態は Durable Object が持つ。D1 は永続 metadata、R2 は動画・event log、KV は静的 scenario/runbook のキャッシュに限定する。KV は読み取りが一時的に古くなる可能性があるため、進行中セッションの真実の状態には使わない [R16]。Durable Objects は stateful coordination と WebSocket 接続の集約に向いている [R7][R8]。

Cloudflare Sandbox はプレイセッションごとに分離する。Sandbox SDK は VM-level isolation を提供するが、アプリケーション側で入力検証・rate limiting を実装する必要がある [R4]。ユーザー入力を backend-generated command に混ぜる場合は、command string へ直接埋め込まず、stdin / file API / allowlist を使う [R2][R4]。

## 1. 採用スタック

| 領域                | 採用                                   | 理由                                                                                                         | 参照                 |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| Frontend            | Preact + TypeScript + Vite             | 軽量で React 互換層もあり、TypeScript 設定が明確。ゲーム UI は canvas 主体なので巨大な UI framework は不要。 | [R19][R20][R21][R22] |
| Terminal            | xterm.js + Cloudflare Sandbox terminal | ブラウザ terminal UI と Sandbox shell を WebSocket で接続できる。Cloudflare Sandbox 公式 addon もある。      | [R3][R23][R24]       |
| Canvas recording    | Canvas API + MediaRecorder             | canvas の映像を MediaStream にし、timeslice ごとに Blob chunk を受け取れる。                                 | [R25][R26][R27][R28] |
| Audio               | Web Audio API                          | alert 音も録画に入れる場合、AudioContext から MediaStreamDestination を作って canvas stream と合成する。     | [R30][R31][R32]      |
| API server          | Hono on Cloudflare Workers             | Workers で TypeScript API を書きやすく、binding へのアクセスも自然。                                         | [R17][R18]           |
| Session coordinator | Durable Objects                        | セッション単位の状態、WebSocket/SSE fanout、scenario tick、multiplayer 拡張に向く。                          | [R7][R8]             |
| Sandbox runtime     | Cloudflare Sandbox SDK                 | isolated Linux environment、command execution、terminal WebSocket、file/process 操作が要件に合う。           | [R1][R2][R3][R4][R5] |
| Metadata DB         | D1                                     | replay/session/scenario metadata の relational query に向く。prepared statement を使う。                     | [R12][R13][R14]      |
| Object storage      | R2                                     | 動画、thumbnail、JSONL event log の保存先。Workers binding から stream を put/get できる。                   | [R10][R11]           |
| Static config cache | KV                                     | scenario/runbook の配布キャッシュ。live state には使わない。                                                 | [R15][R16]           |

> 命名に関する注記: 本書に登場するコード識別子 `unyoh` / `unlang` / `unctl` / `slack_*` は現行実装のもの。新名称(社内基幹サービス「やまびこ」/ 社内 DSL「こだま」/ チャット)への移行は youken.md「旧名称からの移行メモ」を参照。ドキュメント側の世界観記述が正であり、コード識別子は移行完了まで現行のまま併記する。

## 2. 全体アーキテクチャ

```txt
Browser
  |
  | HTTPS API / WebSocket / SSE
  v
Cloudflare Worker (Hono)
  |
  | session routing / validation
  v
Session Durable Object  <----------------------+
  |                                            |
  | scenario state / timeline / connections    |
  |                                            |
  +--> Cloudflare Sandbox SDK -----------------+
  |       |
  |       +--> sandbox container
  |             - unyoh-api
  |             - fake-db
  |             - batch
  |             - log generator
  |             - metrics exporter
  |             - fault injector
  |             - kodama runtime
  |
  +--> D1: session/replay/scenario metadata
  |
  +--> R2: video chunks / final video / JSONL event log / thumbnail
  |
  +--> KV: scenario and runbook cache
```

### 2.1 責務分離

Worker は stateless routing layer。Hono routing、request validation、R2/D1 binding 操作、Durable Object への dispatch を担当する。

Session Durable Object は stateful runtime。1 play session に 1 object を対応させ、scenario clock、trigger 発火、alert 配信、event log 追記、terminal/replay 状態、multiplayer 接続管理を担当する。Durable Objects は状態と storage を持ち、複数 client の coordination に使える [R7]。

Cloudflare Sandbox は壊してよい実行環境。ユーザーの疑似 SSH/terminal 操作、プロセス再起動、ログ閲覧、ファイル編集、batch 実行、障害注入の実体を担当する。Sandbox SDK は command execution、background process、terminal WebSocket、file operation を提供する [R1][R2][R3]。

D1 は検索可能な metadata。session 一覧、replay 一覧、scenario version、結果、採点ではない summary index を持つ。

R2 は巨大/追記的 object。動画、録画 chunk、JSONL event log、thumbnail を持つ。R2 は object put/get/list と multipart upload を Workers binding 経由で扱える [R10][R11]。

KV は配布用 cache。scenario YAML、runbook markdown、こだま仕様表の immutable version を cache する。KV は global low-latency だが read-after-write の最新性が弱い場面があるため、プレイ中状態には使わない [R15][R16]。

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

## 4. Canvas 内録画設計

### 4.1 録画方式

録画対象は `gameCanvas` のみ。ブラウザ全体録画や `getDisplayMedia()` は使わない。

基本フロー:

```ts
const canvasStream = gameCanvas.captureStream(30);
const mimeType = pickSupportedMimeType();
const recorder = new MediaRecorder(canvasStream, {
  mimeType,
  videoBitsPerSecond,
});
recorder.start(5000);
```

`captureStream()` は canvas 内容の `MediaStream` を返す [R25]。`MediaRecorder` は `MediaStream` を録画し、`start(timeslice)` によって一定間隔の `dataavailable` event を発火できる [R26][R27]。

### 4.2 MIME type 選択

browser support 差異があるため、`MediaRecorder.isTypeSupported()` で決める [R28]。

推奨順:

```ts
const candidates = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];
```

`video/mp4` は対応 browser 差がある。MVP の正式対応 browser は Chrome / Edge / Firefox を優先し、Safari は `isTypeSupported` の結果で録画可否を表示する。

### 4.3 音声を録画する場合

alert 音も replay に残すなら、Web Audio API で録画用 audio stream を作る。`AudioContext` は audio node graph を管理する API で、`createMediaStreamDestination()` は録音・送信用の MediaStream destination を作れる [R30][R31]。

```ts
const audioContext = new AudioContext();
const audioDest = audioContext.createMediaStreamDestination();

const mixed = new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...audioDest.stream.getAudioTracks(),
]);

const recorder = new MediaRecorder(mixed, {mimeType});
```

注意:

- AudioContext は autoplay blocking の影響を受けるため、ユーザー操作後に開始する必要がある browser が多い。ブリーフィングの「開始」ボタンで `audioContext.resume()` する [R38]。
- MVP で音声が不要なら video only でよい。alert は視覚 overlay と event log で残す。

### 4.4 chunk upload と final video

MediaRecorder の `timeslice=5000` は「録画 chunk を 5 秒ごとに受け取る」ための設定であり、R2 multipart の part とは別物として扱う [R26][R27]。

保存は次の 2 系統にする。

1. raw chunk 保存
   - key: `replays/{replayId}/chunks/{seq}.webm`
   - 目的: 通信断・録画途中終了・partial replay・debug
   - D1: `replay_chunks` に `seq`, `objectKey`, `byteSize`, `startedAtMs`, `endedAtMs`, `sha256` を保存

2. final video 保存
   - key: `replays/{replayId}/video.webm`
   - 目的: 通常の `<video>` 再生、公開共有
   - 実装: R2 multipart upload
   - 重要: R2 multipart は part を upload し、最後に `complete(uploadedParts)` する [R10]。part は原則同じサイズ、最後だけ小さくできる [R10]。Cloudflare の例では 5 MB が最小 part size と説明されている [R11]。

ブラウザ側の buffer 方針:

```txt
MediaRecorder 5s Blob
  -> raw chunk upload
  -> append bytes to mpuBuffer
  -> while mpuBuffer >= 8MiB:
       upload fixed-size part
  -> on stop:
       upload final leftover part
       complete multipart upload
```

8 MiB は例。Cloudflare の sample は 10 MB part を使っている [R11]。MVP では `RECORDING_MPU_PART_SIZE=8MiB` または `10MiB` を環境変数で固定する。

### 4.5 録画 state machine

```txt
idle
  -> consent_required
  -> initializing
  -> recording
  -> stopping
  -> finalizing
  -> ready

error states:
  recording_error
  upload_degraded
  finalization_failed
  unsupported_browser
```

録画失敗時の扱い:

- `MediaRecorder` 作成失敗: replay video なし。event log は継続。
- chunk upload 失敗: IndexedDB に一時保存し retry。retry 不能なら `upload_degraded`。
- final video complete 失敗: raw chunks から partial replay を提供。
- tab close: `visibilitychange`, `pagehide` で best effort flush。完全保証はしない。

### 4.6 thumbnail

結果画面用 thumbnail は scenario 終了時に canvas から `toBlob("image/webp")` で生成し、R2 に保存する。origin-clean 問題があるため、録画時と同じ asset policy を守る [R25]。

## 5. Replay 設計

### 5.1 Replay page の構成

Replay page は DOM UI でよい。録画対象ではない。

表示:

- `<video controls src="/api/replays/{id}/video">`
- timeline
- alerts
- command list
- runbook list
- important events

動画と timeline は `video.currentTime` と event `at` を同期する。

```ts
function seekToEvent(event: ReplayEvent) {
  video.currentTime = event.at / 1000;
}
```

### 5.2 event log と動画の同期

event log の `at` は session start からの monotonic milliseconds とする。`Date.now()` だけに依存せず、browser では `performance.now()`、server では session DO の logical clock を使う。

event log record:

```ts
type ReplayEvent = {
  id: string;
  replayId: string;
  type: ReplayEventType;
  at: number;
  wallTime?: string;
  actor: 'player' | 'system' | 'scenario' | 'sandbox';
  payload: Record<string, unknown>;
  visibility: 'public_safe' | 'private' | 'sensitive';
};
```

R2 保存形式は JSONL。

```jsonl
{"id":"evt_001","type":"session_start","at":0,"actor":"system","payload":{"scenarioId":"disk-full-001"}}
{"id":"evt_002","type":"alert","at":12000,"actor":"scenario","payload":{"message":"HTTP 500 rate is above threshold"}}
```

### 5.3 partial replay

final video がない場合は、raw chunk manifest から再生する。

MVP fallback:

1. chunk list を取得する。
2. browser が chunk を順番に fetch する。
3. `new Blob(chunks, { type: mimeType })` で object URL を作る。
4. `<video src={URL.createObjectURL(blob)}>` で再生する。

`URL.createObjectURL()` は Blob 用 URL を作成できる [R33]。長時間動画ではメモリを使うため、completed replay は final video を優先する。

将来改善:

- MediaSource Extensions で chunk append。
- async assembly Worker / queue で final object を生成。
- Range request 対応の単一 final object を標準にする。

## 6. Backend 設計

### 6.1 Hono app

Hono は Cloudflare Workers で動作し、bindings は `c.env` から扱える [R17]。

```ts
type Bindings = {
  DB: D1Database;
  REPLAY_BUCKET: R2Bucket;
  SCENARIO_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace<SessionDurableObject>;
  Sandbox: DurableObjectNamespace;
};

const app = new Hono<{Bindings: Bindings}>();
```

WebSocket route は Cloudflare Sandbox terminal proxy を使う場合、Hono の `upgradeWebSocket` helper よりも `sandbox.terminal(request)` を優先する [R3]。Hono の WebSocket helper は custom WebSocket API には使えるが、middleware が headers を変更する場合に注意が必要 [R18]。

### 6.2 API routes

MVP API:

```txt
GET    /api/scenarios
GET    /api/scenarios/:scenarioId

POST   /api/sessions
GET    /api/sessions/:sessionId
POST   /api/sessions/:sessionId/start
POST   /api/sessions/:sessionId/resolve
POST   /api/sessions/:sessionId/retire
DELETE /api/sessions/:sessionId

GET    /api/sessions/:sessionId/events        SSE
GET    /api/sessions/:sessionId/ws/terminal   WebSocket
POST   /api/sessions/:sessionId/terminal/resize

POST   /api/replays
POST   /api/replays/:replayId/chunks
POST   /api/replays/:replayId/mpu/create
PUT    /api/replays/:replayId/mpu/parts/:partNumber
POST   /api/replays/:replayId/mpu/complete
POST   /api/replays/:replayId/events
POST   /api/replays/:replayId/finish
GET    /api/replays/:replayId
GET    /api/replays/:replayId/video
GET    /api/replays/:replayId/events
```

### 6.3 Session Durable Object

1 session = 1 Durable Object。

状態:

```ts
type SessionState = {
  sessionId: string;
  scenarioId: string;
  scenarioVersion: string;
  replayId: string;
  status:
    | 'created'
    | 'briefing'
    | 'running'
    | 'resolved'
    | 'failed'
    | 'retired'
    | 'aborted';
  startedAt?: string;
  finishedAt?: string;
  gameTimeMs: number;
  sandboxId: string;
  activeAlerts: Alert[];
  commandHistory: CommandSummary[];
  openedRunbooks: string[];
  successState: SuccessConditionState[];
};
```

役割:

- scenario definition を読み込む。
- Sandbox を作成/初期化する。
- trigger を時刻通りに発火する。
- metrics/log/alert を client に配信する。
- terminal input/output の summary event を記録する。
- success conditions を評価する。
- replay metadata を更新する。

Durable Object WebSocket hibernation は将来の multiplayer / observer に有効。Hibernation API は idle 時に object を evict しても connection を維持できるが、in-memory state は reset されるため attachment / storage から復元する必要がある [R8]。MVP の active game session は tick と WebSocket があるため、まず通常稼働でよい。

## 7. Cloudflare Sandbox 設計

### 7.1 Sandbox の位置づけ

Cloudflare Sandbox SDK は Workers から isolated Linux environment を操作する SDK。command execution、file 操作、background process、terminal、preview URL を提供する [R1][R2][R3]。Sandbox は Containers 上に構築され、isolated container / VM boundary を持つ [R1][R4][R6]。

MVP では session ごとに sandbox を作る。

```ts
const sandbox = getSandbox(env.Sandbox, `session-${sessionId}`);
```

ユーザー単位共有 sandbox は避ける。同一 sandbox 内では filesystem/process/network を共有するため、完全分離したい単位ごとに sandbox を分ける [R4]。

### 7.2 Sandbox 内プロセス

MVP sandbox:

```txt
/workspace
  /services
    unyoh-api/      # やまびこ の疑似 API（現行実装の識別子は unyoh-api のまま。移行予定）
    fake-db/
    batch/
  /runbooks
  /logs
  /scenario
  /bin
    unctl
    inject_fault
    unlang
```

起動プロセス:

- `unyoh-api`: 社内基幹サービス「やまびこ」の疑似 Web API。`/health`, `/orders`, `/metrics` を持つ（現行実装の識別子は unyoh-api のまま。移行予定）。
- `fake-db`: lightweight process。実 DB でなくてもよい。port と log を持つ。
- `batch-runner`: こだま batch を実行する。
- `log-generator`: access log / application log を出す。
- `metrics-exporter`: JSON metrics を吐く。
- `fault-injector`: scenario trigger から呼ばれる。

Sandbox SDK の `startProcess()` は long-running process を起動し、`waitForPort()` や log 取得を使える [R2]。command timeout では underlying process が残る場合があるため、timeout 後は session delete / sandbox destroy / process kill を設計に入れる [R2]。

### 7.3 コマンド実行

terminal は `sandbox.terminal(request, { cols, rows })` で browser WebSocket を proxy する [R3]。

backend が scenario trigger として command を実行する場合は `sandbox.exec()` / `execStream()` / `startProcess()` を使う [R2]。

ユーザー入力を backend command に入れる場合:

悪い例:

```ts
await sandbox.exec(`cat ${filename}`);
```

良い例:

```ts
const safe = validateScenarioPath(filename);
await sandbox.exec(`cat ${safe}`);
```

より良い例:

```ts
await sandbox.writeFile('/tmp/input', userInput);
await sandbox.exec('python /workspace/bin/process_input.py', {
  stdin: userInput,
});
```

Sandbox docs は stdin を使うことで shell injection risk を避けやすいと説明している [R2]。また SDK の security model は input validation / rate limiting をアプリ側責務としている [R4]。

### 7.4 障害注入

障害注入は shell 文字列を直書きで散らさず、plugin interface にする。

```ts
interface FaultPlugin {
  type: string;
  prepare(ctx: ScenarioContext): Promise<void>;
  inject(ctx: ScenarioContext, params: unknown): Promise<void>;
  cleanup(ctx: ScenarioContext): Promise<void>;
  detect(ctx: ScenarioContext): Promise<DetectionResult>;
}
```

MVP plugins:

- `process_stop`: `api.down` マーカーを書き、`unyoh-api` プロセスを停止する。
- `disk_full`: log file を増やす。または quota directory に大きな file を作る。
- `unlang_batch_failure`: こだま batch に 0 division を仕込む（現行実装の識別子は unlang_batch_failure のまま。移行予定）。

障害は「実際に壊れる」が、sandbox 外に影響しないことを最優先する。

## 8. Scenario 定義

### 8.1 Schema

YAML を source とし、build 時または起動時に JSON schema / Zod で検証する。

```yaml
id: disk-full-001
version: 1
title: 'ログが世界を埋め尽くす夜'
difficulty: beginner
time_limit_minutes: 12

service:
  name: 'やまびこ API'
  health_url: 'http://localhost:3000/health'

sandbox:
  image: 'unyoh-mvp:2026-06-20'  # やまびこ MVP イメージ（現行実装の識別子は unyoh-mvp のまま。移行予定）
  startup:
    - id: api
      command: 'node /workspace/services/unyoh-api/server.js'
      wait_for_port: 3000
    - id: fake-db
      command: 'node /workspace/services/fake-db/server.js'
      wait_for_port: 15432

triggers:
  - at_ms: 60000
    type: disk_full
    params:
      path: '/workspace/logs/debug.log'
      bytes: 838860800

alerts:
  - at_ms: 90000
    severity: critical
    message: 'HTTP 500 rate is above threshold'

success_conditions:
  - type: http_status
    url: 'http://localhost:3000/health'
    status: 200
  - type: disk_usage_below
    path: '/workspace'
    value_percent: 80
  - type: process_running
    process_id: 'api'
```

### 8.2 Success condition

success condition は player の「復旧完了」宣言時に評価する。常時評価も行い、UI に復旧の兆候は出すが、宣言前に自動 clear しない。

```ts
type SuccessCondition =
  | {type: 'http_status'; url: string; status: number}
  | {type: 'disk_usage_below'; path: string; valuePercent: number}
  | {type: 'process_running'; processId: string}
  | {type: 'log_absent'; path: string; pattern: string}
  | {type: 'unlang_batch_ok'; jobId: string};
```

### 8.3 Time model

game time は session start からの logical ms。

- scenario trigger: `at_ms`
- replay event: `at`
- video sync: `at / 1000`

一時停止を入れる場合は `pausedDurationMs` を差し引く。MVP ではプレイ中 pause なし。

## 9. データモデル

### 9.1 D1 tables

D1 は Worker binding から使い、prepared statement + bind を基本にする。D1 docs は binding 経由アクセス、prepared statement の `bind()`、`run()` を提供している [R13][R14]。

```sql
create table scenarios (
  id text not null,
  version integer not null,
  title text not null,
  difficulty text not null,
  manifest_object_key text not null,
  created_at text not null,
  primary key (id, version)
);

create table play_sessions (
  id text primary key,
  scenario_id text not null,
  scenario_version integer not null,
  sandbox_id text not null,
  replay_id text not null,
  status text not null,
  started_at text,
  finished_at text,
  result text,
  duration_ms integer,
  created_at text not null
);

create table replays (
  id text primary key,
  session_id text not null,
  scenario_id text not null,
  difficulty text not null,
  started_at text not null,
  finished_at text,
  duration_ms integer,
  result text,
  video_object_key text,
  event_log_object_key text,
  thumbnail_object_key text,
  browser_info_json text,
  recording_status text not null,
  mime_type text,
  created_at text not null,
  updated_at text not null
);

create table replay_chunks (
  replay_id text not null,
  seq integer not null,
  object_key text not null,
  byte_size integer not null,
  started_at_ms integer,
  ended_at_ms integer,
  sha256 text,
  uploaded_at text not null,
  primary key (replay_id, seq)
);

create table replay_events_index (
  replay_id text not null,
  event_id text not null,
  type text not null,
  at_ms integer not null,
  summary text,
  visibility text not null,
  primary key (replay_id, event_id)
);

create table replay_multipart_uploads (
  replay_id text primary key,
  object_key text not null,
  upload_id text not null,
  next_part_number integer not null,
  uploaded_parts_json text not null,
  status text not null,
  created_at text not null,
  updated_at text not null
);
```

### 9.2 D1 consistency

進行中セッションの強い一貫性が必要な state は Durable Object に寄せる。D1 は metadata 永続化に使う。複数 query の sequential consistency が必要な read path では D1 `withSession()` を検討する [R13]。

## 10. Event log

### 10.1 Event type

MVP event type:

```ts
type ReplayEventType =
  | 'session_start'
  | 'session_end'
  | 'scenario_event'
  | 'alert'
  | 'monitor_update'
  | 'terminal_input'
  | 'terminal_output'
  | 'command_detected'
  | 'ui_click'
  | 'ui_panel_open'
  | 'runbook_open'
  | 'slack_message_read' // 現行実装の識別子。`chat_message_read` へ改称予定
  | 'file_opened'
  | 'service_restart'
  | 'recovery_check'
  | 'incident_resolved'
  | 'player_note'
  | 'recording_chunk_created'
  | 'recording_error';
```

### 10.2 JSONL 保存

イベントは Durable Object で受け、短い buffer に貯め、一定件数または一定秒数で R2 object へ flush する。R2 object は追記 API ではないため、MVP は以下のどちらかにする。

推奨:

- `replays/{id}/events/{seq}.jsonl` として分割保存。
- session end で manifest `events-manifest.json` を作る。
- replay page は manifest に従って読む。

代替:

- Durable Object storage に event を蓄積し、終了時に 1 本の JSONL を R2 に put。
- 10-15 分 MVP なら成立しやすいが、通信断 partial replay には弱い。

## 11. Metrics / Logs / Alerts

### 11.1 Metrics model

metrics は「Sandbox 内の実体」と「シナリオ演出」を合わせる。

```ts
type MetricsSnapshot = {
  at: number;
  cpu: number;
  memory: number;
  disk: number;
  http5xxRate: number;
  latencyP95Ms: number;
  rps: number;
  dbConnections: number;
  queueDepth: number;
};
```

MVP は metrics exporter が JSON を吐く。

```json
{
  "at": 120000,
  "cpu": 34,
  "memory": 62,
  "disk": 97,
  "http5xxRate": 0.18,
  "latencyP95Ms": 1200
}
```

Session DO は 1-2 秒ごとに metrics を取得して client に SSE 配信する。Worker/Sandbox の subrequest limit があるため、過剰な `exec()` polling は避ける。Sandbox SDK の各 operation は Workers subrequest limit の影響を受ける [R5]。

### 11.2 Logs

ログは sandbox 内 file として存在させる。

```txt
/workspace/logs/access.log
/workspace/logs/app.log
/workspace/logs/batch.log
/workspace/logs/debug.log
```

terminal から `tail -f` できる。UI の log viewer は backend が file tail を proxy してもよいが、MVP は terminal 操作を中心にする。

### 11.3 Alerts

alert は scenario definition から発火する。実 metrics threshold から自動発火する拡張も可能。

Alert object:

```ts
type Alert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  firedAtMs: number;
  acknowledgedAtMs?: number;
  source: 'scenario' | 'monitor';
};
```

## 12. こだま

> 注記: 本章の構文・CLI(`unlang`)・拡張子(`.un`)は現行実装のもの。目標仕様(新構文)は youken.md「こだま(社内 DSL)」節で定義済みで、DSL トークン・CLI 名・拡張子の移行は未着手。

### 12.1 目的

こだまは、障害対応で「仕様を読んで原因を推測する」体験を作るための小さな DSL。MVP では batch script と config expression に限定する。

### 12.2 Syntax(現行実装)

```txt
うんちく <text>              comment
うん <name> = <expr>         variable declaration / assignment
うん？ <expr>                if truthy
うーん <expr>                calculate / evaluate
うん！ <expr?>               return

operators:
  うんたす    +
  うんひく    -
  うんかけ    *
  うんわり    /

literals:
  うんなし    0 / false
  うんあり    1 / true

runtime error:
  こだまが返ってきません
```

### 12.3 Parser / evaluator

MVP は手書き parser でよい。文法が小さく、学習教材として error 表示を制御したいから。

```txt
Program     := Statement*
Statement   := Comment | Assignment | Return | ExprStatement
Assignment  := "うん" Identifier "=" Expression
Return      := "うん！" Expression?
Expression  := Term (("うんたす" | "うんひく") Term)*
Term        := Factor (("うんかけ" | "うんわり") Factor)*
Factor      := Number | Boolean | Identifier | "(" Expression ")"
```

内部 error は構造化する。

```ts
type UnlangRuntimeError = {
  code: 'DIVISION_BY_ZERO' | 'UNDEFINED_VARIABLE' | 'SYNTAX_ERROR';
  line: number;
  column: number;
  internalMessage: string;
  playerMessage: 'こだまが返ってきません'; // 現行データは移行予定
};
```

player-facing log は `こだまが返ってきません` のみ。Runbook / 仕様表 / file 内容から 0 division を推測させる。

### 12.4 実行方法

Sandbox 内に `unlang` CLI を置く。

```txt
unlang run /workspace/services/batch/sales.un
unlang check /workspace/services/batch/sales.un
```

batch failure scenario では深夜 3 時相当の trigger で `unlang run` が失敗し、`/workspace/logs/batch.log` に曖昧な error を出す。

## 13. Security

### 13.1 Sandbox isolation

Sandbox SDK は separate VM による filesystem/process/network/resource isolation を説明している [R4]。ただし同一 sandbox 内では filesystem/process/network を共有する [R4]。したがって本サービスでは次を守る。

- 1 play session = 1 sandbox。
- sandbox に本物の secret を入れない。
- sandbox から外部 API に出す通信は原則禁止。必要な場合は Worker proxy 経由。
- session 終了時に sandbox を destroy / cleanup する。

### 13.2 Command injection

terminal の raw input は sandbox shell に流す。これは sandbox 内で完結する前提。ただし backend が user input を使って `sandbox.exec()` を組み立てる場合は別問題。

禁止:

```ts
await sandbox.exec(`grep ${query} /workspace/logs/app.log`);
```

許可:

```ts
await sandbox.exec('python /workspace/bin/search_log.py', {stdin: query});
```

または allowlist:

```ts
const command = allowedCommands[commandId];
await sandbox.exec(command.render(validatedParams));
```

### 13.3 Replay privacy

録画には terminal input、チャット風 UI、表示名が映る可能性がある。共有前に preview と warning を出す。

共有 replay で隠す候補:

- user display name
- player_note
- terminal_input marked sensitive
- チャット風 private message

MVP では sandbox に PII/secret を入れず、ユーザー自由入力を最小化する。

### 13.4 R2 object access

R2 object key は user input から直接作らない。`replayId` は ULID/UUID、`seq` は integer validation。

```txt
replays/{replayId}/video.webm
replays/{replayId}/chunks/{seq}.webm
replays/{replayId}/events/{seq}.jsonl
replays/{replayId}/thumbnail.webp
```

R2 bucket は無条件 public にせず、Worker 経由で object を返す。object key は推測困難にする。

### 13.5 SQL injection

D1 query は prepared statement + bind を使う。D1 docs は `prepare(...).bind(...)` を推奨し、SQL injection 対策になると説明している [R14]。

## 14. Performance

### 14.1 Frontend

録画中の負荷要因:

- canvas redraw
- MediaRecorder encoding
- chunk upload
- terminal output rendering
- metrics animation

対策:

- capture FPS は 30。60 FPS は不要。
- resolution は 1080p 固定から開始。高品質設定は後回し。
- terminal mirror は 80x24 / 120x30 程度に制限。
- 大量 terminal output は event log には summary、動画には画面表示分だけ。
- upload は recorder callback 内で重い処理をせず queue に渡す。
- network retry は exponential backoff。

### 14.2 Backend

- metrics polling は 1 秒未満にしない。
- Sandbox SDK operation は subrequest と timeout に注意する [R5]。
- D1 write は event ごとに同期 insert しすぎない。index だけ batch、JSONL は R2。
- R2 multipart upload state は Durable Object または D1 に保存する。R2 multipart guide は uploadId と uploaded parts の state 管理が必要と説明している [R11]。

## 15. Availability / Failure handling

### 15.1 通信断

Browser:

- event queue を IndexedDB に buffer。
- recording chunk も upload 完了まで IndexedDB に保持する。
- reconnect 後に未送信 chunk/event を再送する。

Session DO:

- client disconnect を検出。
- session は一定時間 `disconnected` として維持。
- time limit は進め続けるか停止するかを scenario policy で決める。MVP は停止しない。

### 15.2 Sandbox failure

Sandbox が落ちた場合:

- UI に sandbox error を表示。
- event log に `sandbox_error` を残す。
- replay は partial として残す。
- scenario result は `aborted` または `failed`。

### 15.3 Recording failure

録画が失敗しても game は続ける。録画は学習補助であり、プレイ進行の hard dependency にしない。

## 16. Testing

### 16.1 Unit tests

- scenario YAML validation
- trigger scheduling
- success condition evaluation
- event log schema
- kodama lexer/parser/evaluator
- R2 key generation
- MIME type selection

### 16.2 Integration tests

- Hono route + D1/R2 binding
- Session DO lifecycle
- Sandbox command wrapper with fake sandbox
- recording upload API idempotency
- replay metadata creation

Cloudflare Workers のテストは Hono docs が `@cloudflare/vitest-pool-workers` を推奨している [R17]。

### 16.3 Browser tests

Playwright で確認:

- gameCanvas が blank でない。
- REC overlay が入る。
- terminal input が canvas に描画される。
- `MediaRecorder.isTypeSupported()` fallback が働く。
- 5 秒 chunk が upload される。
- result page の video と timeline が同期する。

### 16.4 Manual compatibility matrix

| Browser        | 必須確認                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| Chrome stable  | WebM VP9/VP8, canvas capture, xterm, upload                               |
| Edge stable    | Chrome と同等                                                             |
| Firefox stable | WebM, MediaRecorder chunk, xterm                                          |
| Safari         | `video/mp4` / MediaRecorder support。未対応なら event log replay のみ表示 |

## 17. MVP 実装順

> 注記: 本章は初期実装時の計画。現状のステータスは youken.md「現状ステータスとロードマップ」節を参照。

1. Project scaffold
   - Vite + Preact + TypeScript
   - Hono Worker
   - wrangler bindings stub

2. Scenario schema
   - YAML loader
   - 16 scenarios(beginner 3 / intermediate 9 / advanced 4。当初計画は 3 本)
   - runbook data

3. Sandbox image
   - unyoh-api
   - fake-db
   - log files
   - unlang CLI
   - fault injector

4. Session DO
   - create/start/finish
   - scenario clock
   - alert broadcast
   - success condition evaluation

5. Terminal
   - xterm.js connection
   - Sandbox terminal WebSocket
   - terminal mirror into canvas
   - command detection

6. Game canvas
   - triple monitor renderer
   - metrics panel
   - terminal panel
   - runbook/チャット panel
   - cursor/click effects
   - REC overlay

7. Recording
   - captureStream
   - MediaRecorder
   - chunk upload
   - R2 raw chunk storage
   - R2 multipart final video
   - failure fallback

8. Replay
   - video playback
   - JSONL timeline
   - command/alert/runbook list
   - seek sync

9. Security hardening
   - command allowlist for backend exec
   - R2 key validation

10. Tests and load check

- unit/integration/browser
- 15 min recording test
- sandbox cleanup test

## 18. 技術リスクと対策

| リスク                                    | 影響                                 | 対策                                             |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| xterm.js DOM が canvas 録画に入らない     | replay に terminal が映らない        | terminal mirror を canvas に描画する             |
| canvas が origin tainted                  | `captureStream()` / thumbnail が失敗 | asset を same-origin/CORS 設定に統一             |
| MediaRecorder codec 差異                  | 録画不可 browser が出る              | `isTypeSupported()` fallback と録画なし mode     |
| R2 multipart part size                    | final video complete 失敗            | fixed-size byte buffer で part 化                |
| tab close で upload 未完了                | replay 欠損                          | raw chunk + IndexedDB retry + partial replay     |
| KV stale read                             | live session state が古い            | KV を static cache に限定                        |
| Sandbox cost/cold start                   | セッション開始が遅い                 | briefing 中に warm up、MVP は session 数制限     |
| Worker subrequest limit                   | metrics polling/command 多発で失敗   | DO で集約、polling 間隔制限、Sandbox 内 exporter |
| replay 共有で入力内容露出                 | privacy issue                        | preview、warning、redaction flag                 |
| full-screen terminal app の mirror 不完全 | replay 表示ずれ                      | MVP は必要操作を line-oriented command に寄せる  |

## 19. 拡張(実装済み・将来)

### 19.1 Multiplayer(実装済み: Exercise Room)

当初「将来拡張」として置いていた multiplayer は Exercise Room として実装済み(`apps/worker/src/pure/exerciseRoom.ts`、Durable Object 上)。roles は `incident_commander` / `ops` / `scribe` / `comms` / `facilitator` / `observer` の6種。room state として参加者 presence、task、inject、incident log、hotwash note、after-action report を保持する。WebSocket hibernation を使う場合は attachment と storage で connection state を復元する [R8]。

### 19.2 DevTools 風 UI

実 Chrome DevTools を埋め込むのではなく、Network / Console / Application 風 panel を自前実装する。source は sandbox app の request log、browser-side simulated storage、server logs。MVP は HTTP request log viewer で代替する。

### 19.3 Replay comment

`replay_comments` table を追加し、`at_ms` に紐づく comment を保存する。動画 seek と同期する。

### 19.4 Scenario marketplace

scenario package を immutable object として R2 に保存し、D1 に version metadata を持つ。review 済み scenario のみ production に出す。

## 20. 実装時の Do / Don't

Do:

- 録画に残したいものは `GameRenderState` に入れる。
- `MediaRecorder` の MIME type は必ず runtime 判定する。
- recording chunk と R2 multipart part を分けて考える。
- live session state は Durable Object に置く。
- D1 は prepared statement を使う。
- sandbox には本物の secret を入れない。

Don't:

- DOM にだけ重要 UI を表示しない。
- `getDisplayMedia()` でブラウザ全体録画に逃げない。
- user input を shell command に直接埋め込まない。
- KV を進行中 session の truth にしない。
- R2 bucket を雑に public にしない。
- 録画失敗でプレイ全体を落とさない。

## 21. 参照元一覧

この一覧は本書作成時に確認した一次情報・公式資料。文中の `[Rxx]` は下記に対応する。

### 要件

- [R0] [youken.md](./youken.md)

### Cloudflare Sandbox / Containers

- [R1] [Cloudflare Sandbox SDK Overview](https://developers.cloudflare.com/sandbox/)
- [R2] [Cloudflare Sandbox SDK - Commands](https://developers.cloudflare.com/sandbox/api/commands/)
- [R3] [Cloudflare Sandbox SDK - Terminal](https://developers.cloudflare.com/sandbox/api/terminal/)
- [R4] [Cloudflare Sandbox SDK - Security model](https://developers.cloudflare.com/sandbox/concepts/security/)
- [R5] [Cloudflare Sandbox SDK - Limits](https://developers.cloudflare.com/sandbox/platform/limits/)
- [R6] [Cloudflare Containers Overview](https://developers.cloudflare.com/containers/)
- [R34] [Cloudflare Sandbox SDK llms.txt](https://developers.cloudflare.com/sandbox/llms.txt)
- [R35] [Cloudflare Sandbox SDK - Stream output](https://developers.cloudflare.com/sandbox/guides/streaming-output/)

### Cloudflare Workers / Durable Objects / Storage

- [R7] [Cloudflare Durable Objects Overview](https://developers.cloudflare.com/durable-objects/)
- [R8] [Cloudflare Durable Objects - Use WebSockets / Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [R9] [Cloudflare Workers - WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [R10] [Cloudflare R2 - Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R11] [Cloudflare R2 - Use the R2 multipart API from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [R12] [Cloudflare D1 Overview](https://developers.cloudflare.com/d1/)
- [R13] [Cloudflare D1 - D1 Database Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R14] [Cloudflare D1 - Prepared statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [R15] [Cloudflare Workers KV Overview](https://developers.cloudflare.com/kv/)
- [R16] [Cloudflare Workers KV - Read key-value pairs](https://developers.cloudflare.com/kv/api/read-key-value-pairs/)

### Hono

- [R17] [Hono - Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [R18] [Hono - WebSocket Helper](https://hono.dev/docs/helpers/websocket)
- [R36] [Hono - Hono Stacks](https://hono.dev/docs/concepts/stacks)
- [R37] [Hono - Context API](https://hono.dev/docs/api/context)

### Frontend framework / build / typing

- [R19] [Preact Guide - Differences to React](https://preactjs.com/guide/v10/differences-to-react/)
- [R20] [Preact Guide - TypeScript](https://preactjs.com/guide/v10/typescript/)
- [R21] [Vite Guide](https://vite.dev/guide/)
- [R22] [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

### xterm.js

- [R23] [xterm.js - Using addons](https://xtermjs.org/docs/guides/using-addons/)
- [R24] [xterm.js - Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)

### Browser APIs / MDN

- [R25] [MDN - HTMLCanvasElement.captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [R26] [MDN - MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [R27] [MDN - MediaRecorder dataavailable event](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)
- [R28] [MDN - MediaRecorder.isTypeSupported()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [R29] [MDN - Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [R30] [MDN - AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)
- [R31] [MDN - AudioContext.createMediaStreamDestination()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination)
- [R32] [MDN - MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)
- [R33] [MDN - URL.createObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
- [R38] [MDN - Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
