# tech: セキュリティ・性能・可用性

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

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
