# 設計書: Web Speech コンテキストバイアスによる音声インシデントログ

- ステータス: 設計(未実装)
- 対象: `apps/web`(プレイ画面)
- 前提Chrome: コンテキストバイアス(フレーズリスト)は 142 から、`quality` パラメータは 150 から(いずれもデスクトップ)

## 1. 背景と目的

実際のオンコール対応では、手はキーボード(ターミナル)に置いたまま、口頭で状況を共有しながら記録を残す。ゲームでもこれを再現し、**プレイヤーが声で「気づき・判断・仮説」をインシデントログに追記できる**ようにする。ターミナル操作(中央モニタ)を中断せずにログ(タイムライン)が育つため、訓練の「型」である「記録を残しながら対応する」を自然に習慣づけられる。

課題は音声認識の精度で、汎用認識は「やまびこ」「DB プール」「5xx」「p95」のようなゲーム内固有語を誤認識しやすい。Chrome 142 で入った **コンテキストバイアス(フレーズリスト)** は、認識器にフレーズ辞書と重み(boost)を渡して固有語の認識精度を上げられる。シナリオ定義(トポロジーのノード名、メトリクス名、インジェクト名)から辞書を動的生成することで、シナリオごとに最適化された音声認識を実現する。

出典:

- https://github.com/WebAudio/web-speech-api/blob/main/explainers/contextual-biasing.md
- https://github.com/WebAudio/web-speech-api/blob/main/explainers/quality-levels.md
- https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md
- https://chromestatus.com/feature/5225615177023488 (contextual biasing, M142)
- https://chromestatus.com/feature/5136859632107520 (quality levels, M150)

## 2. API仕様の要点(公式ソース準拠)

| 項目             | 内容                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| フレーズ登録     | `recognition.phrases = [new SpeechRecognitionPhrase(phrase, boost), ...]`                                                                            |
| boost            | 0.0〜10.0 の float。高いほどそのフレーズが認識されやすい(既定 1.0)                                                                                   |
| quality          | `SpeechRecognitionOptions.quality: 'command' \| 'dictation' \| 'conversation'`(既定 `command`)。`available()` / `install()` に渡す。M150〜           |
| オンデバイス認識 | `SpeechRecognition.available({langs, processLocally})` → `'available' \| 'downloadable' \| 'downloading' \| 'unavailable'`。`install()` でモデル取得 |
| processLocally   | 既定 false(false なら利用可能な任意の認識方式が使われる)                                                                                             |
| 注意             | コンテキストバイアスは「オンデバイス認識のみ対応の UA がありうる」と explainer に明記。フレーズ非対応時は `phrases-not-supported` エラーが発生しうる |
| Origin Trial     | どちらも OT なしで全ユーザー向けに出荷(chromestatus 記載)                                                                                            |

## 3. スコープ

### 第1弾(この設計書の実装範囲)

- **プッシュトゥトーク方式の音声ログ追記**: マイクボタン(または `V` キー長押し)で録音開始、離すと認識結果をインシデントログに追記
- シナリオ定義からのフレーズ辞書自動生成
- 発話頭のキーワードによる `kind` 自動分類(「仮説、」→ `hypothesis` など)

### 第2弾以降(この設計書ではやらない)

- `quality: 'command'` を使った短文音声コマンド(「メトリクス開いて」でモニタ拡大など)
- マルチプレイでの発話者表示・音声チャット連携

## 4. 設計

### 4.1 モジュール構成

Prompt API 実装(`effect/promptAssistant.ts` + `pure/aiAssist.ts` + `app/AiAssistPanel.tsx`)の構成に倣う。

```
apps/web/src/
  pure/speechPhrases.ts      # フレーズ辞書生成・kind分類(純粋関数、テスト対象)
  effect/speechLog.ts        # SpeechRecognition のラッパー(副作用層)
  app/useSpeechIncidentLog.ts # プレイ画面へのフック統合
```

### 4.2 フレーズ辞書の生成(`pure/speechPhrases.ts`)

`ScenarioDefinition` と固定語彙からフレーズリストを組み立てる純粋関数。

```ts
export interface SpeechPhrase {
  phrase: string;
  boost: number; // 0.0〜10.0
}

export function buildSpeechPhrases(
  scenario: ScenarioDefinition | undefined
): SpeechPhrase[];
```

| ソース                               | 例                                                     | boost |
| ------------------------------------ | ------------------------------------------------------ | ----- |
| トポロジーのノード label             | 「やまびこ API」「ユーザー」                           | 3.0   |
| インジェクト・ランブックのタイトル語 | 「DB プール」                                          | 2.5   |
| メトリクス固定語彙                   | 「5xx」「p95」「レイテンシ」「キュー」「コネクション」 | 2.0   |
| ログ分類キーワード                   | 「仮説」「判断」「連絡」「フォローアップ」「メモ」     | 2.0   |

boost はまず控えめ(≤3.0)から始める。過大な boost は誤爆(無関係な発話が固有語に吸われる)を招くため、上限 10.0 は使わない。辞書はシナリオロード時に一度生成し、セッション中は固定とする。

### 4.3 kind の自動分類(`pure/speechPhrases.ts`)

`INCIDENT_LOG_KINDS`(`pure/webmcpTools.ts:97`)への写像。発話の先頭語で分類し、該当なしは `note`。

```ts
export function classifySpokenLog(transcript: string): {
  kind: IncidentLogEntryKind;
  body: string; // 先頭のキーワードと区切りを除いた本文
};
// 「仮説、DBプールが枯渇している」→ {kind: 'hypothesis', body: 'DBプールが枯渇している'}
// 「判断。APIを再起動する」→ {kind: 'decision', body: 'APIを再起動する'}
```

先頭一致キーワード: 仮説→`hypothesis` / 判断・決定→`decision` / 連絡・共有→`comms` / フォローアップ・宿題→`follow_up` / メモ・記録→`note`。

### 4.4 認識ラッパー(`effect/speechLog.ts`)

`promptAssistant.ts` と同様に、実験的APIの型を局所的に定義して feature detection する。

```ts
export type SpeechLogAvailability =
  | 'unsupported' // SpeechRecognition なし
  | 'no-phrase-support' // 認識は可能だがフレーズリスト非対応
  | 'ready';

export function detectSpeechLogAvailability(): SpeechLogAvailability;

export function startSpeechCapture(options: {
  phrases: SpeechPhrase[];
  onResult: (transcript: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}): {stop(): void};
```

実装方針:

- `webkitSpeechRecognition` / `SpeechRecognition` の存在確認後、インスタンスの `'phrases' in recognition` でバイアス対応を判定
- `lang = 'ja-JP'`、`interimResults = true`(認識途中経過をUIに出す)、`continuous = false`(プッシュトゥトーク1回分)
- `recognition.phrases` に `SpeechRecognitionPhrase` を設定。コンストラクタが未定義の環境ではフレーズなしで続行(認識自体は動かす)
- `onerror` で `phrases-not-supported` を受けたらフレーズなしで1回だけ再試行
- **オンデバイス優先はしない**: `processLocally` は既定(false)のまま。explainer 上「バイアスはオンデバイス限定の UA がありうる」ため、将来 `SpeechRecognition.available({langs: ['ja-JP'], processLocally: true})` が `available` を返す環境ではローカル優先に切り替える拡張余地を残す(ja-JP のオンデバイスモデル提供状況は未確認のため、第1弾では判定コードのみ入れてログ出力に留める)
- `quality` は第1弾では未使用(M150 の `dictation` が本用途に合うが、Proposed 段階のため feature detection だけ実装しコメントで言及)

### 4.5 プレイ画面への統合(`app/useSpeechIncidentLog.ts`)

- **起動UI**: DOM側(canvas外)にマイクボタンを置く。`AiAssistPanel.tsx` と同じ配置作法。キーボードは `V` 長押し(ターミナルの `focusCommandInput` 中は無効。既存のコマンド入力と衝突させない)
- **権限ゲート**: 追記前に `canContributeRecords(state.room.participants, state.localParticipantId)`(`pure/rolePermissions.ts:33`)を確認。observer はマイクボタン自体を無効表示にする(サーバ側ゲートのミラー)
- **追記経路**: WebMCP ツール `append_incident_log` と同じ内部経路(`useWebMcpTools.ts` が使う追記処理)を共用する。`parseAppendLogArgs` 相当のトリム・1000字制限も共通化
- **確認ステップ**: 認識結果は即追記せず、認識テキスト+分類 kind をトースト風UIに表示して Enter / クリックで確定、Esc で破棄する。誤認識をそのままタイムラインに残さないため
- **リプレイ**: 追記は既存のインシデントログイベントとして記録されるため追加対応不要。発話由来であることを残すなら payload に `source: 'speech'` を足す(リプレイスキーマ拡張は任意)

### 4.6 マイク権限とフォールバック

- 初回はブラウザのマイク許可プロンプトが出る。拒否時はボタンを「マイク未許可」表示にし、以後自動で出さない
- `unsupported` 環境(Firefox 等)ではボタン自体を出さない。ゲームのコア体験には影響しない(WebMCP / Prompt API と同じプログレッシブエンハンスメント方針)

## 5. テスト計画

- 単体(`pure/speechPhrases.ts`): シナリオ→辞書生成(ノード label 抽出、boost 上限)、`classifySpokenLog` の kind 分類と本文抽出(句読点・読点区切りのバリエーション)
- 単体(`effect/speechLog.ts`): SpeechRecognition モックで、フレーズ設定・`phrases-not-supported` 時の再試行・stop の羃等性
- 統合: 認識結果確定→ログ追記が `canContributeRecords` でゲートされること(observer で追記されない)
- 手動: 実機 Chrome で「やまびこ」「DB プール」等の固有語がバイアスあり/なしで認識差が出ることを確認(バイアス効果は自動テスト不能)

## 6. リスクと判断

| リスク                                                                        | 対応                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| コンテキストバイアスは chromestatus 上 "Proposed" であり仕様変更がありうる    | フレーズ設定を `effect/speechLog.ts` の1箇所に閉じ、`phrases-not-supported` フォールバックを最初から実装する       |
| ja-JP でバイアスが効かない(オンデバイス限定の可能性、ja モデル提供状況未確認) | バイアスなしでも音声ログ機能自体は成立する設計にする。効果は手動確認で計測し、効かなければ辞書は温存して将来有効化 |
| 誤認識がタイムラインを汚す                                                    | 確定前の確認ステップを必須にする(4.5)                                                                              |
| マルチプレイで複数人が同時発話                                                | 第1弾はローカルプレイヤーのマイクのみ。認識はクライアントローカルで完結し、追記だけが同期される                    |

## 7. 実装タスク分解

1. `pure/speechPhrases.ts` + 単体テスト
2. `effect/speechLog.ts`(feature detection・ラッパー)+ 単体テスト
3. `useSpeechIncidentLog.ts` + マイクボタンUI + 確認トースト
4. ログ追記経路の共通化(`useWebMcpTools.ts` との共用関数抽出)
5. 手動での認識精度確認(バイアスあり/なし比較)と boost 調整
