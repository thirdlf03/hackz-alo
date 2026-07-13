# 疎結合化リファクタリング計画

> **Status: 完了・アーカイブ**(2026-07-12 確認)
> `node scripts/audit-coupling.mjs` で全数値目標を達成(App.tsx 709行 ≤ 1100 / SessionDurableObject.ts 739行 ≤ 750 / index.ts 86行 ≤ 260 / runtime.ts 20行 ≤ 420、すべて ok)。Phase 1〜7 の切り出しモジュールも実在を確認済み。

## 目的

現状のコードは主要機能を少数の大きなファイルが抱えており、UI、状態遷移、API 通信、録画、Sandbox 操作、永続化、描画が近い距離で結合している。

この計画の目的は、外部挙動を変えずに責務境界を明確にし、変更時の影響範囲を小さくすること。実装前に重要境界のテストを追加し、各段階で品質ゲートを通す。

## 現状ベースライン

2026-06-22 時点の主な密結合ポイント:

| 対象                                              |                        現状 | 問題                                                                                                                  |
| ------------------------------------------------- | --------------------------: | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/App.tsx`                        | 約 1,775 行、内部 import 21 | UI component が session lifecycle、terminal、recording、editor、SSE、metrics polling、replay event を直接管理している |
| `apps/web/src/game/render/canvasRenderer.ts`      |                 約 2,055 行 | 描画処理が `GameRenderState` / `ScenarioDefinition` の加工も行っている                                                |
| `apps/worker/src/durable/SessionDurableObject.ts` |                 約 1,047 行 | DO が HTTP dispatch、状態機械、timeline scheduler、SSE、DB 永続化、Sandbox 操作を抱えている                           |
| `apps/worker/src/index.ts`                        |                   約 568 行 | Hono routing、DB/R2 操作、DO proxy、replay route が同居している                                                       |
| `apps/worker/src/sandbox/runtime.ts`              |                   約 482 行 | fault / success condition ごとの command builder が if/else chain に密集している                                      |
| `apps/web/src/api/client.ts`                      |                   約 408 行 | session / replay / recording / SSE API と replay event sequence が単一 client にまとまっている                        |
| `apps/worker/src/sandbox/assets.ts`               |        巨大な埋め込み文字列 | sandbox 内ファイルと repo 内実ファイルの同期保証が弱い                                                                |

直近の検証ベースライン:

- `pnpm run fmt:check` pass
- `pnpm run typecheck` pass
- `pnpm run lint` pass
- `pnpm test` pass: 91 tests
- `pnpm run build` pass
- `node --test --experimental-test-coverage tests/unit/*.mjs` line coverage: 77.27%

## 全体ゴール

以下を満たしたら、このリファクタリング計画は完了とする。

1. 主要な密結合ポイントが domain / adapter / UI 表示 / side effect に分離されている。
2. `App.tsx`、`SessionDurableObject.ts`、`index.ts`、`sandbox/runtime.ts` が、それぞれ現在より責務の少ない orchestration 層になっている。
3. 新しく切り出した純粋関数・command builder・state transition helper は単体テストで直接検証できる。
4. 既存ユーザー向け挙動を変えない。ゲーム開始、terminal 操作、editor 操作、録画保存、replay 表示、session 終了が維持される。
5. 品質ゲートがすべて通る。

完了判定の数値目標:

| 指標                                        |     現状 |                                         完了目標 |
| ------------------------------------------- | -------: | -----------------------------------------------: |
| `App.tsx` 行数                              | 約 1,775 |                                     1,100 行以下 |
| `App.tsx` 内部 import 数                    |       21 |                                          12 以下 |
| `SessionDurableObject.ts` 行数              | 約 1,047 |                                       750 行以下 |
| `apps/worker/src/index.ts` 行数             |   約 568 |                                       260 行以下 |
| `sandbox/runtime.ts` の fault if/else chain |     あり | registry 化し、分岐の追加は table 追加だけにする |
| 新規抽出 module の line coverage            |     なし |                                         90% 以上 |
| 全体 line coverage                          |   77.27% |                          77.27% 未満に落とさない |
| lint warning/error                          |        0 |                                                0 |

補足: 全体 coverage はファイル分割で揺れるため、最重要指標は「新規抽出 module の直接テスト」とする。全体 coverage は退行検知の下限として使う。

## 品質ゲート

各 phase 完了時に必ず通す。

```sh
pnpm run fmt:check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
node --test --experimental-test-coverage tests/unit/*.mjs
```

`pnpm test`、`pnpm run build`、coverage は sandbox 制約で local listen / IPC pipe が必要なため、必要に応じて sandbox 外で実行する。

## Phase 0: 計測を固定する

目的: 疎結合化の進捗を主観で判断しないようにする。

作業:

- `scripts/audit-coupling.mjs` を追加し、以下を出力する。
  - file LOC
  - internal import fan-out
  - internal import fan-in
  - 指定ファイルの閾値超過
- 現在の閾値を設定する。
  - `App.tsx <= 1100`
  - `SessionDurableObject.ts <= 750`
  - `index.ts <= 260`
  - `sandbox/runtime.ts <= 420`
- CI または手元の品質ゲートに audit を含めるか判断する。

完了条件:

- `node scripts/audit-coupling.mjs` で現状値と目標値が表示される。
- 以降の phase で数値の増減を確認できる。

## Phase 1: Web App の runtime 責務を分離する

対象:

- `apps/web/src/app/App.tsx`

問題:

- `App` が UI 表示だけでなく、session 作成、terminal 接続、recording、SSE、metrics polling、editor API、終了処理を直接持っている。
- refs が多く、どの副作用がどの状態に依存しているか追いづらい。

切り出し案:

- `apps/web/src/app/useSessionRuntime.ts`
  - session 作成、start、end、timeout、clock snapshot 適用
  - `currentGameTimeMs`
  - timeline reset
- `apps/web/src/game/terminal/useTerminalBridge.ts`
  - `TerminalSession` の生成、resize、interrupt、snapshot 反映
  - terminal command replay event 発火
- `apps/web/src/game/recording/useCanvasRecording.ts`
  - `CanvasRecorder`、`RecordingFinalizer`、offline queue、finish replay
  - recording clock segments
- `apps/web/src/game/editor/useSessionEditor.ts`
  - file list/read/write
  - editor status/error/dirty 更新
  - file opened/saved event
- `apps/web/src/game/metrics/useMetricsPolling.ts`
  - metrics polling
  - threshold crossing event

実装順:

1. `useSessionRuntime` から作る。既存の `createSessionForScenario`, `startPlay`, `endSession`, `applyClockSnapshot`, `currentGameTimeMs` を移す。
2. `useSessionEditor` を作る。`loadEditorFiles`, `openEditorFile`, `saveEditorFile` を移す。
3. `useTerminalBridge` を作る。`attachTerminalSession`, `syncTerminalViewport`, terminal key side effects を移す。
4. `useCanvasRecording` を作る。録画 effect と finish replay 周辺を移す。
5. `App.tsx` は screen routing と JSX composition を主責務にする。

テスト方針:

- hook 内の純粋 helper を module 化して単体テストする。
- recording finish の分岐は `finishRecordingSession` のような関数にし、以下をテストする。
  - 保存あり / 保存なし
  - finalize 成功 / 失敗
  - video HEAD 成功 / 失敗
- editor は API mock を渡す service にし、loading/error/ready/dirty transition をテストする。

Phase 1 完了条件:

- `App.tsx` が 1,250 行以下になる。
- `App.tsx` が `TerminalSession`, `CanvasRecorder`, `RecordingFinalizer`, `OfflineUploadQueue` を直接 import しない。
- `App.tsx` 内部 import 数が 15 以下になる。
- 新規 module の line coverage が 90% 以上。
- 品質ゲートがすべて通る。

## Phase 2: Sandbox runtime の registry 化

対象:

- `apps/worker/src/sandbox/runtime.ts`

問題:

- `injectFault` が fault type ごとの if/else chain になっている。
- `evaluateSuccessCondition` も condition type ごとの command builder と実行が密結合している。
- scenario に fault type を追加すると runtime の大きな関数を編集する必要がある。

切り出し案:

- `apps/worker/src/sandbox/faultCommands.ts`
  - `buildFaultCommand(type, params): string`
  - `faultCommandBuilders: Record<string, FaultCommandBuilder>`
- `apps/worker/src/sandbox/successEvaluators.ts`
  - `buildSuccessCheckCommand(condition): string`
  - `successConditionBuilders`
- `apps/worker/src/sandbox/pathSafety.ts`
  - `shellArg`
  - `shellPathSegment`
  - workspace path guards

実装順:

1. path / shell escaping helper を抽出して既存テストを通す。
2. fault command builder を registry に移し、`injectFault` は lookup + exec だけにする。
3. success condition builder を registry に移し、`evaluateSuccessCondition` は lookup + exec だけにする。
4. unknown type の error behavior を固定する。

テスト方針:

- 各 fault type が期待する command を生成すること。
- `shellArg` が single quote を安全に escape すること。
- path traversal / null byte / absolute path 制約を落とさないこと。
- unknown fault / unknown success condition の error を固定すること。

Phase 2 完了条件:

- `injectFault` 内に fault type 列挙の if/else chain がない。
- `evaluateSuccessCondition` 内に condition type 列挙の if/else chain がない。
- fault type 追加時の変更箇所が registry entry とテストだけになる。
- `sandbox/runtime.ts` が 420 行以下になる。
- 新規 command builder module の line coverage が 90% 以上。
- 品質ゲートがすべて通る。

## Phase 3: Worker routes を分割する

対象:

- `apps/worker/src/index.ts`

問題:

- route 定義、DB query、R2 response、DO proxy、validation が同じファイルにある。
- replay route では `getReplay`、404、query parsing が繰り返されている。

切り出し案:

- `apps/worker/src/http/response.ts`
  - `ok`, `err`, `jsonOk`, `jsonErr`
- `apps/worker/src/http/params.ts`
  - `parseSequence`, `parsePartNumber`, `normalizeOptionalMs`
- `apps/worker/src/routes/scenarioRoutes.ts`
- `apps/worker/src/routes/sessionRoutes.ts`
- `apps/worker/src/routes/replayRoutes.ts`
- `apps/worker/src/repositories/replayRepository.ts`
  - replay lookup
  - comments
  - replay metadata update

実装順:

1. response / params helper を抽出する。
2. replay route を `registerReplayRoutes(app)` へ移す。
3. session route を `registerSessionRoutes(app)` へ移す。
4. scenario route を `registerScenarioRoutes(app)` へ移す。
5. `index.ts` は app creation、route registration、sandbox proxy、scheduled handler だけにする。

テスト方針:

- parse helper の境界値。
- replay id / seq / part number validation。
- 既存 route contract test を必要に応じて追加する。

Phase 3 完了条件:

- `index.ts` が 260 行以下になる。
- route file ごとの責務が scenario / session / replay で分かれている。
- `index.ts` から replay SQL が消える。
- 品質ゲートがすべて通る。

## Phase 4: SessionDurableObject を状態機械と adapter に分離する

対象:

- `apps/worker/src/durable/SessionDurableObject.ts`

問題:

- 状態遷移、clock、scenario timeline、SSE、DB persistence、Sandbox 操作が 1 class に集約されている。
- private method が多く、状態遷移だけを単体テストしづらい。

切り出し案:

- `apps/worker/src/durable/sessionState.ts`
  - `StoredSession`
  - `createBriefingSession`
  - `startStoredSession`
  - `finishStoredSession`
  - `isTerminalStatus`
  - `getGameTimeMs`
- `apps/worker/src/durable/sessionClock.ts`
  - clock sync
  - lifecycle alarm deadline 計算
- `apps/worker/src/durable/scenarioTimeline.ts`
  - due trigger / alert / slack の計算
  - timer scheduling は DO 側 adapter に残す
- `apps/worker/src/durable/sessionPersistence.ts`
  - `persistSession`
  - `persistReplayStart`
  - `persistReplayResult`
  - `persistReplayEvent`
- `apps/worker/src/durable/sseHub.ts`
  - SSE controller 管理
  - replay / snapshot broadcast
- `apps/worker/src/durable/sessionRouter.ts`
  - method + action dispatch table

実装順:

1. `StoredSession` と純粋状態 helper を抽出する。
2. `getGameTimeMs` と lifecycle alarm deadline を抽出してテストする。
3. `sessionPersistence` を抽出する。DO は persistence adapter を呼ぶだけにする。
4. `sseHub` を抽出する。
5. `fetch` の if/else dispatch を route table に置き換える。
6. timeline scheduler は最後に切る。ここは alarm / setTimeout / storage が絡むため小さく進める。

テスト方針:

- 状態遷移 helper:
  - briefing -> running
  - running -> resolved / failed / retired / aborted
  - terminal status の idempotency
- clock helper:
  - speed 変更
  - wall clock から game clock への換算
  - idle / game end alarm deadline
- timeline helper:
  - fired IDs を除外する
  - alert / slack / trigger の due 判定

Phase 4 完了条件:

- `SessionDurableObject.ts` が 750 行以下になる。
- `fetch` の action dispatch が table 化される。
- 状態遷移と clock 計算が DO instance なしで単体テストできる。
- 新規 durable helper module の line coverage が 90% 以上。
- 品質ゲートがすべて通る。

## Phase 5: Canvas renderer を view model 駆動にする

対象:

- `apps/web/src/game/render/canvasRenderer.ts`

問題:

- renderer が描画だけでなく、runbook visibility、Slack merge、unread 判定など state 加工を行っている。
- `gameState.ts` の domain helper を renderer が直接 import しており、描画層が domain state に密結合している。

切り出し案:

- `apps/web/src/game/render/canvasViewModel.ts`
  - `buildCanvasViewModel(state, scenario)`
  - visible runbooks
  - merged Slack messages
  - unread flags
  - active panel labels
- renderer は `CanvasViewModel` を受け取って描く。
- 互換移行中は `CanvasRenderer.draw(state, scenario)` の内部で view model を作ってもよいが、最終的には view model 生成を外に出す。

実装順:

1. right panel 用 view model から始める。
2. notification / metrics / header view model を順に移す。
3. renderer から `gameState.ts` import を消す。
4. `CanvasRenderer` の public API を安定させる。

テスト方針:

- view model の単体テスト:
  - runbook arrival
  - Slack player/server merge
  - unread badge
  - notification count
- rendering pixel test はこの phase では必須にしない。既存 canvas behavior は build/type/unit で守る。

Phase 5 完了条件:

- `canvasRenderer.ts` が `gameState.ts` を import しない。
- `canvasRenderer.ts` が 1,700 行以下になる。
- `canvasViewModel.ts` の line coverage が 90% 以上。
- 品質ゲートがすべて通る。

## Phase 6: ApiClient を domain client に分ける

対象:

- `apps/web/src/api/client.ts`

問題:

- `ApiClient` が scenario、session、terminal、replay、recording upload、SSE をまとめて持っている。
- `eventSeq` が client instance 全体にあるため、replay/session 境界より広い mutable state になっている。

切り出し案:

- `apps/web/src/api/httpClient.ts`
  - `request`, `get`, `post`, `put`
- `apps/web/src/api/sessionApi.ts`
- `apps/web/src/api/replayApi.ts`
- `apps/web/src/api/recordingUploadApi.ts`
  - event sequence を replay scoped にする
- `apps/web/src/api/scenarioApi.ts`
- 必要なら facade として `ApiClient` を残し、段階移行する。

実装順:

1. `HttpClient` を抽出し、既存 `ApiClient` から使う。
2. replay API を切り出す。
3. session API を切り出す。
4. recording upload API を切り出し、event sequence を replay scoped にする。
5. `App` / hooks 側は必要な client だけを受け取る。

テスト方針:

- URL building。
- `ApiResult` error handling。
- event sequence reset / replay scope。
- `sendBeacon` fallback。

Phase 6 完了条件:

- `ApiClient` か facade が 180 行以下になる。
- recording event sequence が global client state ではなく replay scoped になる。
- session / replay / recording の consumer が必要な client だけを import する。
- 品質ゲートがすべて通る。

## Phase 7: Sandbox assets の同期保証

対象:

- `apps/worker/src/sandbox/assets.ts`
- `sandbox/bin/*`
- `sandbox/services/*`

問題:

- sandbox 内へ展開する実装が巨大な string として worker 側に埋め込まれている。
- `sandbox/` 側の実ファイルと `assets.ts` の内容がずれる可能性がある。

切り出し案:

- 既存の `scripts/sync-sandbox-assets.mjs` を前提にする。
- `scripts/check-sandbox-assets.mjs` を追加し、生成結果が current `assets.ts` と一致するか検証する。
- CI / 品質ゲートに check を追加する。

実装順:

1. sync script の出力仕様を確認する。
2. check script を追加する。
3. `pnpm run check:sandbox-assets` を追加する。
4. assets の実装変更時は `sandbox/` 実ファイルを source of truth にする。

Phase 7 完了条件:

- sandbox asset mismatch をコマンドで検出できる。
- `assets.ts` を直接手編集しなくてよい運用になる。
- 品質ゲートがすべて通る。

## 推奨実施順

1. Phase 0: 計測固定
2. Phase 2: Sandbox runtime registry 化
3. Phase 1: Web App runtime 分離
4. Phase 3: Worker routes 分割
5. Phase 4: SessionDurableObject 分割
6. Phase 5: Canvas renderer view model 化
7. Phase 6: ApiClient 分割
8. Phase 7: Sandbox assets 同期保証

理由:

- Phase 2 は局所的でテストしやすく、早く成果が出る。
- Phase 1 は効果が大きいが触る範囲も広いので、先に計測と小さな成功体験を作る。
- Phase 4 はゲーム進行の中核なので、route/API 周辺を整理してから進める。

## リスクと対策

| リスク                                 | 対策                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| refactor 中にゲーム進行が壊れる        | 各 phase の前に重要境界テストを追加する                                       |
| ファイル分割で import cycle が発生する | domain helper は UI / adapter を import しないルールにする                    |
| coverage が分割で一時的に下がる        | 新規 module coverage 90% を必須にし、全体 coverage は 77.27% 未満に落とさない |
| DO の alarm / setTimeout 挙動が壊れる  | timeline helper は純粋計算だけ抽出し、timer 実行は最後に分ける                |
| App hook 分割で stale closure が増える | refs と callbacks を `useSessionRuntime` に集約し、hook API を明示する        |

## 最終 Done Definition

この計画全体は、以下をすべて満たした時点で完了とする。

- `pnpm run fmt:check` が通る。
- `pnpm run typecheck` が通る。
- `pnpm run lint` が warning/error なしで通る。
- `pnpm test` が通る。
- `pnpm run build` が通る。
- coverage 実行が通り、全体 line coverage が 77.27% 未満に落ちていない。
- 新規抽出 module の line coverage が 90% 以上。
- `App.tsx <= 1100 行`、内部 import `<= 12`。
- `SessionDurableObject.ts <= 750 行`。
- `apps/worker/src/index.ts <= 260 行`。
- `sandbox/runtime.ts` の fault / success condition 分岐が registry 化されている。
- `canvasRenderer.ts` が `gameState.ts` を直接 import しない。
- recording / terminal / editor / session lifecycle が `App.tsx` から hook または service に分離されている。
- session start -> play -> terminal input -> metrics update -> resolve/retire/timeout -> result/replay の主要フローが維持されている。
