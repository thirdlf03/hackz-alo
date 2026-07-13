# 障害対応訓練シミュレーション

`youken.md`(要件・SSoT)と `tech.md`(技術方針)に基づく、障害対応訓練ゲームの実装。
開発に参加する場合は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## 構成

- `apps/web`: Preact/Vite の canvas ゲームとリプレイ UI
- `apps/worker`: Hono/Cloudflare Worker API と Durable Object セッションランタイム
- `packages/shared`: API・シナリオ・リプレイ・描画・ストレージの契約
- `packages/scenarios`: シナリオ定義と Runbook メタデータ
- `sandbox`: sandbox サービスと障害注入のローカルスクリプト
- `migrations`: D1 スキーマ
- `tests`: unit / integration / e2e / vrt テスト
- `docs/production`: runbook、edge 保護、プライバシー、可観測性、[ops-notes](docs/production/ops-notes.md)

## ローカルチェック

```sh
pnpm test
pnpm run test:integration
pnpm run audit:schema-sync
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
```

`pnpm install` で [Lefthook](https://lefthook.dev/) のフックが登録される。
`commit-msg` は Conventional Commits を検査し(規約は [CONTRIBUTING.md](CONTRIBUTING.md))、
`pre-push` は CI の `test` ジョブと同じゲート(`pnpm run ci:test`)を実行する。
一度だけスキップするには `LEFTHOOK=0 git push`。
perf 用 Playwright(`tests/e2e/perf.spec.ts`)はデフォルトの `test:e2e` には含まれず、
`pnpm run perf:e2e` でのみ実行される。

Vite / Worker の dev server を起動する前に workspace の依存をインストールする:

```sh
pnpm install
pnpm run dev:web
pnpm run dev:worker
```

## デプロイ(Worker + 静的フロントエンド)

本番は API(`/api/*`)と同じ Worker から Vite ビルドを配信する。
ローカル開発では従来どおり Vite と Worker の dev server を分けて使う。

Cloudflare の初回セットアップ:

```sh
wrangler login
pnpm run setup:cloudflare
pnpm run db:migrate:remote
```

デプロイ:

```sh
pnpm run deploy
```

本番チェックリストは [docs/production/runbook.md](docs/production/runbook.md) と
[docs/production/cloudflare-edge.md](docs/production/cloudflare-edge.md) を参照。

`pnpm run deploy` はシナリオのビルド → `apps/web/dist` のビルド → `wrangler deploy` の順に実行する。
R2 バケットの作成とコンテナイメージのアップロードはデプロイ時に Wrangler が処理する。

CI からのデプロイは `.github/workflows/deploy.yml`(タグ `v*` または workflow_dispatch)。

### GitHub Actions のシークレット(deploy ワークフロー)

| シークレット           | 用途                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN` | Wrangler デプロイ + D1 リモートマイグレーション                                            |
| `INCIDENT_WORKER_URL`  | デプロイ後の `GET /api/ready` スモーク(カスタムドメイン: `https://incident.thirdlf03.com`) |
| `TURNSTILE_SITE_KEY`   | web ビルド用の Turnstile サイトキー(任意)                                                  |

Cloudflare API トークンには **Workers Scripts Edit**、**D1 Edit**、**Containers Edit**、
**Account Settings Read**、**Zone → Workers Routes → Edit**(`wrangler.toml` の
`incident.thirdlf03.com` に必要)、および `pnpm run setup:edge` を使う場合は
**Turnstile Edit** を付与して:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo thirdlf03/hackz-alo
pnpm run setup:domain   # INCIDENT_WORKER_URL を https://incident.thirdlf03.com に設定
```

## 環境変数(Worker シークレット)

| 名前                    | 用途                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `ENVIRONMENT`           | `production` にすると dev ルートを無効化                              |
| `TURNSTILE_SECRET_KEY`  | セッション作成のボット対策(任意)                                      |
| `ADMIN_SECRET`          | Access JWT がない場合の管理 API フォールバック                        |
| `VAPID_PUBLIC_KEY`      | Web Push の VAPID 公開鍵(ページャー機能。未設定なら機能は無効化)      |
| `VAPID_PRIVATE_KEY`     | Web Push の VAPID 秘密鍵                                              |
| `VAPID_SUBJECT`         | VAPID subject(`mailto:` 形式)                                         |
| `CF_TURN_KEY_ID`        | Cloudflare Calls TURN 鍵の ID(ウォールーム音声。未設定なら STUN のみ) |
| `CF_TURN_KEY_API_TOKEN` | Cloudflare Calls TURN 鍵の API トークン                               |

### ウォールーム音声(WebRTC)の TURN セットアップ

[Cloudflare Calls ダッシュボード](https://dash.cloudflare.com/?to=/:account/calls) で TURN 鍵を作成し、
worker のシークレットに設定すると NAT 越えに Cloudflare TURN が使われます。

```sh
pnpm exec wrangler secret put CF_TURN_KEY_ID -c apps/worker/wrangler.toml
pnpm exec wrangler secret put CF_TURN_KEY_API_TOKEN -c apps/worker/wrangler.toml
```

未設定の場合は `stun:stun.cloudflare.com:3478` のみで接続を試みます(同一 NAT 内なら大抵つながります)。

### ページャー(Web Push)の VAPID 鍵セットアップ

```sh
npx web-push generate-vapid-keys
pnpm exec wrangler secret put VAPID_PUBLIC_KEY -c apps/worker/wrangler.toml
pnpm exec wrangler secret put VAPID_PRIVATE_KEY -c apps/worker/wrangler.toml
pnpm exec wrangler secret put VAPID_SUBJECT -c apps/worker/wrangler.toml   # mailto:... 形式
```

ローカル開発では `apps/worker/.dev.vars` に同名のキーを設定する(`.dev.vars.example` 参照)。未設定の場合、`GET /api/push/public-key` は `{publicKey: null}` を返し、クライアントはページャー UI を表示しない。

## フォントクレジット

`apps/web/public/fonts` に同梱: DotGothic16 (© Fontworks) / IBM Plex Sans JP, IBM Plex Mono (© IBM Corp.)。
いずれも [SIL Open Font License 1.1](https://scripts.sil.org/OFL) の下でセルフホストしている(各フォントディレクトリの `OFL.txt` 参照)。
