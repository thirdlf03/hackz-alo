# AI Assist モダリティ実験レポート — 画面テキスト入力 vs 画像入力

2026-07-14 実施。ブランチ `experiment/ai-assist-state-grounding`。環境: Chrome 150 / macOS / Gemini Nano(Prompt API)、Apple Silicon 10コア。

## 背景と仮説

AI Assist はゲーム canvas のスクリーンショットを Gemini Nano に渡しているが、canvas はアプリ自身が構造化データ(GameRenderState)から描画している。そこで「画像の代わりに描画元の内容をテキスト化して渡せば、画像 prefill(約2.5秒)が消えて速く、OCR 誤読も原理的に無くなり、品質も同等以上になる」と仮説を立てた。

## 結果の要約

**仮説は棄却。** 速度は圧勝(Ask 後 TTFT 中央値 106ms vs 686ms)したが、罠シナリオの正答率が大幅に劣化した。原因切り分けの対照実験により、劣化の原因は「色の強調の喪失」でも「平坦化による構造の喪失」でもなく、**モダリティそのもの**であると特定した。

## 対照実験

罠3ケース(port-conflict / db-pool / runbook-gaslight、`scripts/fixtures/ai-assist-discriminating-cases.json`)× repeat 8 = 各条件24計測。4条件は情報内容が完全に同一(画像はフィクスチャの lines を描画したもの)。

| 条件 | 入力                                       | rubric 正答率 | TTFT 中央値 |
| ---- | ------------------------------------------ | ------------- | ----------- |
| A    | 画像(カラー描画)+ append                   | 83.3%         | 1015ms      |
| B    | 平坦テキスト                               | 25.0%         | 103ms       |
| C    | パネル構造化テキスト(セクション見出し付き) | 29.2%         | 131ms       |
| D    | 画像(モノクロ描画)+ append                 | **95.8%**     | 787ms       |

- **色は原因ではない**: モノクロ(D)がカラー(A)と同等以上。
- **構造喪失も原因ではない**: 構造化(C)は平坦(B)とほぼ同じ。むしろ gaslight で8回中7回、アラート行「Runbook integrity check failed」をそのまま次の一手にする新しい失敗が発生。
- **モダリティが原因**: 同じ文字列でも、画像として渡すと転記に徹する(`cat /workspace/run/fake-db-stats.json` を 8/8 で正確にコピー)。テキストとして渡すと言語の続きとして処理され、言い換え(「port確認」)、省略(次の一手が空)、事前知識への回帰(「DBを再起動」、`tail /var/log/nginx/error.log` の捏造)が起きる。

再現コマンド:

```sh
pnpm run bench:ai-assist -- --current-chrome --append-image --grounding \
  --cases scripts/fixtures/ai-assist-discriminating-cases.json --repeat 8   # A
pnpm run bench:ai-assist -- --current-chrome --state-text --grounding \
  --cases scripts/fixtures/ai-assist-discriminating-cases.json --repeat 8   # B
# C: B に --state-format panels を追加 / D: A に --monochrome を追加
```

計測 JSON: `.perf/ai-assist-exp-{A-image,B-flat,C-panels,D-mono}.json`(gitignore 対象。数値は本レポートに転記済み)。

## 接地バリデーター(採用候補)

`apps/web/src/pure/assistGrounding.ts`。回答の「次の一手:」セクションを画面由来の文字列と決定論的に突合する純関数。実データでの実証:

- **rejected**: 画面にないコマンドの捏造を棄却 — `kubectl rollout restart deployment/api`、`sudo systemctl restart postgresql`、二重パス `ls /workspace/docs/docs/backups`
- **repaired**: 末尾切れコマンドを編集距離で完全形に修復 — `…/service-recovery-` → 完全パス
- **repaired (next-chain-completed)**: NEXT 列の前半だけ答えた回答に確認工程を機械補完 — `yamactl restart api` → `yamactl restart api → curl localhost:8080/health`
- **unverified**: コマンドを含まない曖昧な次の一手(「DBを再起動」等の断片、チャット文の復唱)を要注意に分類

既知の限界: `Wiki` `Runbook` のような普通の英単語もコマンド候補として拾われるため、それらを含む助言文の復唱は素通りし得る。本番組み込みで行の出所タイプ(chat/runbook/terminal)をシリアライザが持てば塞げる。

## 結論と推奨

1. **画面テキストをモデル入力に置き換える最適化は不採用**(速度と引き換えに罠耐性がほぼ全滅)。
2. **採用推奨構成**: 画像入力(append 先行投入で Ask 後 TTFT 約0.7秒)+ 状態シリアライズを正解集合とする接地バリデーター。バリデーターは画像モードの捏造も実際に捕捉した。
3. モノクロ描画がカラーよりわずかに良い可能性(83%→96%)は n=24 では断定不可。追検証の価値あり。
4. テキスト入力を活かすなら「自由生成」ではなく「選択」に課題を変える方向(responseConstraint の enum で画面内コマンドから選ばせる等)が残された道。

## 教訓(一般化)

小型オンデバイスモデルでは、同一内容でも入力モダリティが接地強度を決める。テキストはモデルの言語事前分布に混ざりやすく、画像は「転記すべき外部証拠」として分離される。「構造化テキストの方がモデルに優しい」という直感は Gemini Nano には当てはまらなかった。
