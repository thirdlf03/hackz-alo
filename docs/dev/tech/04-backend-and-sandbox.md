# tech: Backend と Sandbox

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

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
