# AI Assist / Gemini Nano の計測

`scripts/ai-assist-bench.mjs` は、実 Chrome の `LanguageModel` (Gemini Nano) を使い、AI Assist の速度と回答品質を同じ入力セットで計測する。

## 測るもの

| 指標                      | 意味                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `availability.elapsedMs`  | Prompt API の利用可否確認時間                                            |
| `prewarm.sessionCreateMs` | `--current-chrome` でベースセッションを先行作成する時間                  |
| `sessionCloneMs`          | 先行作成したベースから質問用の独立セッションを複製する時間               |
| `sessionCreateMs`         | clone方式では複製時間。通常モードでは新規セッション作成時間              |
| `inputPrepareMs`          | 質問メッセージと合成 canvas の準備時間                                   |
| `ttftMs`                  | prompt 開始から最初の非空 chunk まで                                     |
| `totalMs`                 | prompt 開始から stream 完了まで                                          |
| `endToEndMs`              | セッション作成開始から stream 完了まで。prewarmなしの待ち時間            |
| `charsPerSecond`          | 最初の chunk 後の Unicode 文字/秒。トークン/秒ではない                   |
| `quality.score`           | 必須根拠、推奨アクション、禁止された推測を rubric で決定論的に採点した値 |

`--current-chrome` は本番UIと同じくベースセッションを先行作成し、ケースごとに `clone()` した独立セッションを使う。通常モードはケースごとに新規セッションを作る。どちらも前の会話や画像が次の回答へ影響しない。最初に warmup を行い、モデルのダウンロード時間は推論速度に含めない。モデルが `downloadable` または `downloading` の場合は計測せず終了する。

本番UIはモデルが `available` になった時点でベースセッションを先行作成する。したがって、シナリオ読込中の準備コストは `prewarm.sessionCreateMs`、Ask直後の複製コストは `sessionCloneMs`、回答待ちは `totalMs` として見る。`endToEndMs` は複製開始からstream完了までであり、先行作成時間は含まない。

## 実行

Chrome で Gemini Nano をダウンロード済みにしてから実行する。通常は専用プロファイルを指定すると、モデル状態と計測条件を保ちやすい。

すでに起動している Chrome の現在のプロファイルで、新規タブを開いて計測する場合:

```sh
pnpm run bench:ai-assist -- --current-chrome
```

このモードは既存タブを変更せず、一時的な localhost ページを新規タブで開く。計測完了後、そのタブは閉じてよい。

```sh
pnpm run bench:ai-assist -- --user-data-dir .perf/ai-assist-chrome-profile
```

すでにリモートデバッグ付きで起動した Chrome を使う場合:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.perf/ai-assist-chrome-profile"
pnpm run bench:ai-assist -- --cdp-url http://127.0.0.1:9222
```

結果は既定で `.perf/ai-assist-bench.json` に保存される。主なオプションは次で確認できる。

```sh
pnpm run bench:ai-assist -- --help
```

`--append-image` は `--current-chrome` と併用し、prewarm 済みベースセッションを `clone()` した直後に `session.append()` で画像を先行投入してから `promptStreaming` を呼ぶ、本番UIと同じ入力順序を再現するモードである。`--current-chrome` なしでは使えない。画像投入にかかった時間は `appendMs` として記録され、`inputPrepareMs` や `ttftMs` と切り分けて見られる。

```sh
pnpm run bench:ai-assist -- --current-chrome --append-image
```

## 精度改善の回し方

1. `scripts/fixtures/ai-assist-cases.json` に、実ゲームで失敗した状態と質問を追加する。
2. 画面内に存在する根拠を `requiredAll` / `requiredAny`、言ってはいけない推測を `forbidden` に定義する。
3. 変更前後を同じ Chrome、同じプロファイル、同じ `--repeat` で実行する。
4. JSON の raw response を人手でも確認する。rubric のスコアだけで自然さや助言の有用性を断定しない。

`requiredAny` / `forbidden` は回答全体を対象に判定するため、回答のどこかに正しいキーワードが混ざっていれば、実際の推奨アクションが誤っていても高スコアになりうる(例: 状況説明で正しい犯人プロセスに触れつつ、結論の「次の一手」では的外れな再起動を提案する回答)。これを防ぐため、`nextStepRequiredAny`(`requiredAny` と同じ `string[][]` 形式)と `nextStepForbidden`(`forbidden` と同じ `string[]`)は、回答中の最初の「次の一手」から最初の「根拠」まで(「根拠」がなければ末尾まで)の部分だけを対象に判定する。両フィールドとも省略可能で、指定しなければ従来どおり回答全体のみで採点される。

同梱ケースの canvas はブラウザ内で合成しており、OCR/grounding の回帰を再現可能に確認できる。実際の描画品質も評価する場合は、ケースを固定した実ゲーム canvas のキャプチャを追加し、その時点のシナリオ定義を正解根拠にして rubric を作る。
