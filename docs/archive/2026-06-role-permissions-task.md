# タスク: 役割にゲームプレイ上の意味を持たせる(ターミナル/エディタの役割権限)

> **Status: 実装済み・アーカイブ**(2026-07-12 確認)
> 本タスクは PR #12(`0f3e75ca`)で実装され、フォローアップ `df0a50ed` でターミナル出力ミラー配信に調整済み。unit テストも `tests/unit/exercise-room.test.mjs` に追加済み。

## 背景

参加者役割 `ParticipantRole = incident_commander | ops | scribe | comms | facilitator | observer`(`packages/shared/src/types.ts:180-189`)は現在ほぼ表示のみで意味を持たない。挙動に影響するのは `areParticipantsReadyToStart` の observer 除外(`apps/worker/src/pure/exerciseRoom.ts`)のみ。役割に実効的な意味を持たせる。

調査済みの前提:

- ホストゲート `canPerformRoleGatedAction`(`exerciseRoom.ts`)は `hostParticipantId` のみで判定し role は見ない(これは変えない)
- `SessionActionError`(`apps/web/src/api/httpClient.ts`)は `requiredRole?: ParticipantRole` を持つがサーバーが送っておらず未使用。`describeSessionActionError`(`apps/web/src/app/appUtils.ts`)も code しか見ていない
- 認可は現状セッション共有 write token のみ。write token を持つクライアントが自称する participantId を信頼するモデル(既存ホストゲートと同じ)で構わない — セキュリティ機構ではなく協調プレイのゲームルール

## 仕様(確定)

### 権限ルール

1. **ターミナル入力(PTY WebSocket 接続)・terminal resize・エディタのファイル書き込み**は、role が `ops` または `facilitator` の参加者のみ実行可
2. **`observer` は完全読み取り専用**: タスク作成/更新・incident log 追記・hotwash 送信も不可。チャットは対象外(制限しない)
3. **ソロ救済**: 演習ルームのオンライン参加者(`isParticipantOnline` 判定)が1人以下のときは一切制限しない(ソロプレイの体験を変えない)
4. マルチプレイ時、participantId が送られてこない/ルームに存在しない場合は拒否側に倒す

### サーバー側

- `apps/worker/src/pure/exerciseRoom.ts` に pure 関数を追加:
  - `canOperateSandbox(room, participantId, nowIso?)`: ルール1+3+4。戻り値は `{allowed: true} | {allowed: false}` 形式(既存 `HostGateDecision` の流儀)
  - `canContributeRecords(room, participantId, nowIso?)`: ルール2+3+4(observer のみ拒否)
- `apps/worker/src/http/response.ts` に追加(既存 `hostRequiredResponse` の流儀):
  - `roleRequiredResponse(requiredRole)` → 403 `{error:'role_required', requiredRole}`
  - `observerReadOnlyResponse()` → 403 `{error:'observer_read_only'}`
- 強制ポイント(participantId の受け取りは既存の流儀に合わせて配線):
  - **terminal WS 接続**(`SessionDurableObject` の terminal ハンドラ / `sessionTerminalHandlers.ts`): クライアントが WS URL に付ける `participantId` クエリパラメータを読み、`canOperateSandbox` で拒否なら 403。ルート層(`sessionRoutes.ts` の `/ws/terminal` → `proxySessionRead` → `proxySession`)がクエリパラメータを DO まで素通しするか確認し、必要なら通す
  - **terminal-resize** ハンドラ: body の participantId でチェック
  - **ファイル書き込み**(エディタ保存。`sessionResourceHandlers.ts` の `writeSessionFileContent` と対応ルート): body の participantId でチェック
  - **taskCreate / taskUpdate / incidentLog / hotwash**(`sessionExerciseHandlers.ts`): `canContributeRecords` でチェック。body に既存の actorParticipantId / participantId 系フィールドがあれば流用、なければ追加で受ける
- 読み取り系(GET、SSE、exercise state 取得)は一切制限しない

### クライアント側

- `apps/web/src/pure/` に権限判定のミラー実装を追加(`participantsReady.ts` の流儀。ExerciseSnapshot の participants から自分の role とオンライン人数を見て判定)。サーバー実装とロジックを一致させ、双方のコメントで相互参照
- **participantId の同送**: sessionApi / client.ts の resizeTerminal・ファイル書き込み・タスク・ログ・hotwash 系メソッドと、terminal WS URL 生成(`apps/web/src/game/terminal/session.ts` の `getWebSocketUrl`)に participantId を配線。呼び出し元(App.tsx / useTerminalBridge.ts / useCanvasInteraction.ts など)から自然に渡せる形に
- **ターミナル UI**: 権限がない参加者は `attachTerminalSession` をそもそも行わない(`useExercisePhaseSync.ts` のゲスト経路と、念のため `startPlay` 経路も)。ターミナル入力の入口(画面下部の「コマンドを入力…」入力欄、および canvas/xterm へのキー入力経路を実際に確認)を無効化し、「ターミナル操作は Ops / Facilitator のみ」を表示。ターミナルパネル自体は消さない(無効の理由が分かるように)
- **エディタ**: 権限がない参加者は保存操作を無効化(保存 UI の実際の場所を確認して自然な形で)
- **observer**: タスク追加・記録追加・hotwash の各フォーム/ボタンを無効化し、短い理由表示
- **エラー表示**: `describeSessionActionError` に `'role_required'`(error.requiredRole を使い「この操作には Ops / Facilitator の役割が必要です」等)と `'observer_read_only'`(「Observer は閲覧専用です」)の分岐を追加。既存の `participantRoleLabels`(AppScreens.tsx)を流用
- **ロビーの役割選択 UI** に権限の説明を一言添える(例: 「Ops / Facilitator: ターミナル・エディタを操作できます / Observer: 閲覧専用」)

### テスト

- `tests/unit/exercise-room.test.mjs` に `canOperateSandbox` / `canContributeRecords` のテストを追加:
  - ソロ救済(1人なら role 不問で許可)
  - マルチで ops/facilitator 許可・それ以外拒否
  - observer の記録系拒否
  - participantId 不明時の拒否
  - オフライン参加者を人数に数えない
- 既存テスト(特に `tests/e2e/helpers.ts` のソロフロー)がソロ救済で壊れないことを確認

### 検証

- typecheck / lint / unit テスト / 統合テスト(package.json の scripts: test, test:integration など)がすべて通ること
