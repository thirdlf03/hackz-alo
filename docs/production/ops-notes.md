# Production ops notes

運用方針のメモ（thirdlf03.com / incident-training）。

## Uptime monitoring

Cloudflare zone **Health Checks** は **Pro 以上**が必要。Free プランでは使わない。

**採用方針:** 自前の [Uptime Kuma](https://github.com/louislam/uptime-kuma)（など）で監視。

| Monitor          | URL                                         | 間隔の目安 |
| ---------------- | ------------------------------------------- | ---------- |
| Ready            | `https://incident.thirdlf03.com/api/ready`  | 60s        |
| Liveness（任意） | `https://incident.thirdlf03.com/api/health` | 60s        |

期待: HTTP **200**。落ちたら Kuma の通知（Discord / Slack / メール等）を使う。

デプロイ直後は `pnpm run deploy:smoke` を使う。これは `/api/ready` に加えて
Turnstile 付き session create と private replay access policy を検証する。

```sh
INCIDENT_WORKER_URL=https://incident.thirdlf03.com \
INCIDENT_SMOKE_TURNSTILE_TOKEN=<turnstile-test-token> \
pnpm run deploy:smoke
```

`pnpm run load-test` は追加の容量確認用。

## Billing alerts と Webhook

Cloudflare には **2 種類**ある。混同しないこと。

### 1. Budget alert（月次ドル閾値）

- **場所:** Billing → **Billable Usage** → Create budget alert
- **対象:** アカウント全体の usage 課金（Workers + R2 + D1 など合算）
- **届け方:** **メールのみ**（Webhook なし）
- **用途:** 「今月 $25 超えそう」などの早期警告

設定済みならメールで十分。課金は止まらない（通知のみ）。

### 2. Usage Based Billing（製品別）

- **場所:** **Notifications** → Add → **Usage Based Billing**
- **対象:** 製品ごと（Workers リクエスト数、R2 egress bytes、D1 rows read など）
- **届け方:** Email / **Webhook** / PagerDuty
- **閾値:** ドルではなく **メトリクス**（リクエスト数・バイト数など）

Webhook を使う手順:

1. Notifications → **Destinations** → **Webhook** を追加（URL + 任意 `secret`）
2. Notifications → Add → Usage Based Billing → 製品と閾値を選ぶ
3. Delivery に **Webhook** を指定

検証: 着信 POST の `cf-webhook-auth` ヘッダーが設定した secret と一致するか確認。  
ペイロード形式: [Webhook payload schema](https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/)

### ドル閾値を Webhook にしたい場合

Budget alert には Webhook がない。**自作ポーリング**が必要:

```http
GET /accounts/{account_id}/billable/usage
```

- トークン権限: **Billing Read**
- 日次コストを合算し、閾値超えで自前 Webhook（Kuma / n8n / スクリプト）

Budget alert のメールは残しつつ、Webhook は Usage 通知か自前 API のどちらか。

## `pnpm run setup:ops` の位置づけ

| フラグ           | 内容                             | 備考                                             |
| ---------------- | -------------------------------- | ------------------------------------------------ |
| `--admin`        | `ADMIN_SECRET` → Worker + GitHub | 長いランダム文字列推奨                           |
| `--health`       | CF Health Check + 通知           | **Pro 要**。Free ではスキップ                    |
| `--notify`       | Usage 通知（Workers / R2 / D1）  | `ALERT_EMAIL` 要。Webhook はダッシュボードでも可 |
| `--logpush`      | Workers trace → R2 等            | R2 API キー未設定時は手順のみ表示                |
| `--access-guide` | `/api/admin/*` の Access 手順    | ダッシュボード作業                               |

Free + Uptime Kuma 運用なら:

```sh
pnpm run setup:ops -- --admin --access-guide
# 必要なら --notify（メール）または Notifications UI で Webhook
```

## 実験的 Web API 依存の棚卸し

本サービスは実験的・新しめの Web API に複数依存している。ブラウザ側の仕様変更や
origin trial 終了で黙って壊れるのを防ぐため、**月次**で下表の各 API のステータス
（Chrome Platform Status / origin trial 期限）を確認し、確認日を下の記録に追記する。

| API                                | 用途                                | 非対応時のフォールバック                                               | 実装                                                        |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Prompt API (`LanguageModel`)       | AI Assist / AI NPC / ポストモーテム | `unsupported` 判定で該当 UI 非表示                                     | `apps/web/src/effect/promptAssistant.ts`, `npcPrompt.ts`    |
| WebMCP (`navigator.modelContext`)  | ゲーム内操作のツール公開            | 未対応ならツール登録をスキップ                                         | `apps/web/src/effect/webmcp.ts`                             |
| WebCodecs                          | リプレイの録画・再生                | 録画不可時は録画なしでプレイ継続                                       | `apps/web/src/replay/`, `apps/web/src/pure/webmDemux.ts`    |
| WebRTC + Cloudflare TURN           | ウォールーム音声                    | TURN 鍵未設定なら STUN のみで接続                                      | `apps/web/src/effect/voiceChat.ts`, worker `cloudflareTurn` |
| Web Push (VAPID)                   | ページャー通知                      | 鍵未設定なら `publicKey: null` を返し UI 非表示                        | `apps/worker/src/routes/pushRoutes.ts`                      |
| Document Picture-in-Picture        | 監視モニターの分離表示              | 未対応なら通常表示のまま                                               | `apps/web/src/effect/pipMonitor.ts`                         |
| Web Speech（コンテキストバイアス） | 音声インシデントログ                | `unsupported` でテキスト入力のみ。phrases 非対応はバイアスなしで再試行 | `apps/web/src/effect/speechLog.ts`                          |
| HTML-in-Canvas                     | canvas 内チャット入力               | 未対応なら従来の canvas 描画入力                                       | `docs/dev/html-in-canvas-design.md` 参照                    |

新しく実験的 API を使う機能を追加したら、フォールバックを実装した上でこの表に行を足す
（手順は [CONTRIBUTING.md](../../CONTRIBUTING.md)）。

### 確認記録

| 確認日     | 特記事項                                        |
| ---------- | ----------------------------------------------- |
| 2026-07-13 | 初回作成。全 API のフォールバック実装を確認済み |

## Runbook 実地検証の記録

`runbook.md` / `incident-response.md` は四半期に一度、実際に手順どおり実行して
食い違いを潰し、結果をここに残す（「Runbook が古い」はゲームの中だけにする）。

| 検証日     | 対象ドキュメント | 結果・修正した食い違い |
| ---------- | ---------------- | ---------------------- |
| （未実施） | -                | -                      |

## 本番 URL

- 正式: `https://incident.thirdlf03.com`
- 代替: `*.workers.dev`（引き続き利用可）

## 関連

- [cloudflare-edge.md](./cloudflare-edge.md) — Turnstile、Access、Budget alert 手順
- [observability.md](./observability.md) — ログ、Logpush、推奨シグナル
- [load-test.md](./load-test.md) — 手動キャパシティ確認
- [access-policy.md](./access-policy.md) — replay/session token 境界
- [incident-response.md](./incident-response.md) — インシデント初動
