# Contributing

障害対応訓練シミュレーションの開発に参加するためのガイド。仕様の正(SSoT)は
[`youken.md`](youken.md)、技術方針は [`tech.md`](tech.md)。世界観・仕様で迷ったら
コードよりドキュメントを優先し、ドキュメント側が古い場合はドキュメントを直す PR を先に出す。

## セットアップ

```sh
pnpm install          # Lefthook のフック(commit-msg / pre-push)も登録される
pnpm run build:scenarios
pnpm run dev:web      # Vite dev server
pnpm run dev:worker   # Worker dev server(別ターミナル)
```

## リポジトリ構成

| パス                 | 内容                                                      |
| -------------------- | --------------------------------------------------------- |
| `apps/web`           | Preact/Vite の canvas ゲームとリプレイ UI                 |
| `apps/worker`        | Hono/Cloudflare Worker API と Durable Object セッション   |
| `packages/shared`    | API・シナリオ・リプレイ・描画・ストレージの契約(型と検証) |
| `packages/scenarios` | シナリオ定義(YAML → ビルドで JSON 化)                     |
| `sandbox`            | sandbox サービスと障害注入のローカルスクリプト            |
| `migrations`         | D1 スキーマ                                               |
| `tests`              | unit / integration / e2e / vrt                            |

## テストの層

| 層          | コマンド                    | 対象                                                                          |
| ----------- | --------------------------- | ----------------------------------------------------------------------------- |
| unit        | `pnpm test`                 | 純粋ロジック(`tests/unit/*.mjs`)                                              |
| integration | `pnpm run test:integration` | Worker ルートを本物の Request/Response で駆動(`tests/integration/`)           |
| e2e         | `pnpm run test:e2e`         | Playwright でブラウザからの主要フロー                                         |
| e2e smoke   | `pnpm run test:e2e:smoke`   | e2e のうちゲームコアフロー(success/failure/terminal/editor/replay-access)のみ |
| vrt         | `pnpm run test:vrt`         | 全画面のスクリーンショット基準比較(CI の `vrt` ジョブで実行)                  |
| perf        | `pnpm run perf:e2e`         | 性能ベースライン(default の e2e には含まれない)                               |

PR ゲートでは `test:e2e:smoke` を使い、フル(`test:e2e`)は merge 前・CI で実行する
(フルスイートは workers: 1 で直列実行のため1周に数分かかる)。

`pnpm run test:coverage:check` は line coverage のしきい値ゲート(`.cursor/rules/project-conventions.mdc`
参照)。CI の `test` ジョブはこれを実行する。

VRT のスクリーンショット基準は CI(Linux)で生成したものを使う。更新するときは
`vrt-baseline/**` ブランチを push するか `.github/workflows/vrt-baseline.yml` を
`workflow_dispatch` で手動実行し、artifact `vrt-snapshots` の中身を
`tests/vrt/screens.spec.ts-snapshots/` に配置してコミットする。

perf 回帰ゲート(`pnpm run perf:compare`)は `perf-baselines/main.json` が無いと strict モードで
失敗する。CI の `perf` ジョブが生成する artifact の `report.json` を取得し、
`pnpm run perf:baseline:accept -- --report <path>` で `perf-baselines/main.json` に
取り込んでコミットする。

統合テストは `tests/integration/helpers/routeHarness.mjs` の Hono 互換ハーネスに
ルート登録関数(`registerXxxRoutes`)を載せ、D1 / R2 / Durable Object をインメモリの
フェイクで置き換えて書く。既存の `worker-session-lifecycle.test.mjs` が雛形。
新しいルートやミドルウェアを追加したら、対応する統合テストを同時に追加すること。

## 品質ゲート

`git push` 時に Lefthook が CI の `test` ジョブと同じゲート
(fmt / lint / typecheck / coverage / 各種 audit / perf bench)に加えて integration test を実行する。
まとめて手元で回すなら `pnpm run ci:test`(+ `pnpm run test:integration`)。緊急時のみ
`LEFTHOOK=0 git push` でスキップできるが、CI では同じチェックが必ず走る。

## コミット規約

[Conventional Commits](https://www.conventionalcommits.org/ja/) に従う。
`commit-msg` フックが機械的に検査する(`scripts/check-commit-msg.mjs`)。

```
<type>(<scope>)?: <subject>
```

- type: `feat` `fix` `docs` `test` `refactor` `perf` `chore` `ci` `build` `style` `revert`
- subject は日本語・英語どちらでもよい
- `wip` のような一時コミットは push 前に `git rebase` で整理する

## シナリオの追加手順

1. `packages/scenarios/scenarios/` に既存 YAML(例: `disk-full-001.yaml`)を参考に定義を書く。
   `id` / `version` / `title` / `difficulty` / `difficultyScore` / `timeLimitMinutes` は必須。
   `difficultyScore` は同 difficulty 内の並び順・出題バランスに使う相対値なので、
   既存シナリオのスコアと見比べて位置づけを決める。
2. 障害注入は marker ファイルではなく実プロセス・実症状ベースで書く
   (`sandbox/` のサービスを実際に止める・詰まらせる)。
3. `pnpm run build:scenarios` で検証付きの JSON(`packages/scenarios/data/`)を生成する。
   スキーマ違反はここで落ちる。
4. sandbox 側にアセットが必要なら `pnpm run sync:sandbox-assets` を実行し、
   `pnpm run check:sandbox-assets` が通ることを確認する。
5. シナリオの世界観・トーンが `youken.md` のトーンガイド(禁止事項を含む)に沿っているか確認する。

## ドキュメント

- 仕様変更を伴う PR は `youken.md` の該当節も同じ PR で更新する
- 運用に関わる変更は `docs/production/`(runbook / ops-notes など)へ反映する
- 実験的 Web API を新しく使う場合は、非対応環境でのフォールバック挙動を実装し、
  `docs/production/ops-notes.md` の「実験的 Web API 依存の棚卸し」表に行を追加する
