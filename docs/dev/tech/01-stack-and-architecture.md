# tech: スタックと全体アーキテクチャ

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

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
