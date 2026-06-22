# Production ops notes

運用方針のメモ（thirdlf03.com / incident-training）。

## Uptime monitoring

Cloudflare zone **Health Checks** は **Pro 以上**が必要。Free プランでは使わない。

**採用方針:** 自前の [Uptime Kuma](https://github.com/louislam/uptime-kuma)（など）で監視。

| Monitor | URL | 間隔の目安 |
| ------- | --- | ---------- |
| Ready | `https://incident.thirdlf03.com/api/ready` | 60s |
| Liveness（任意） | `https://incident.thirdlf03.com/api/health` | 60s |

期待: HTTP **200**。落ちたら Kuma の通知（Discord / Slack / メール等）を使う。

`pnpm run load-test` はデプロイ後や設定変更後の手動スモーク用。

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

| フラグ | 内容 | 備考 |
| ------ | ---- | ---- |
| `--admin` | `ADMIN_SECRET` → Worker + GitHub | 長いランダム文字列推奨 |
| `--health` | CF Health Check + 通知 | **Pro 要**。Free ではスキップ |
| `--notify` | Usage 通知（Workers / R2 / D1） | `ALERT_EMAIL` 要。Webhook はダッシュボードでも可 |
| `--logpush` | Workers trace → R2 等 | R2 API キー未設定時は手順のみ表示 |
| `--access-guide` | `/api/admin/*` の Access 手順 | ダッシュボード作業 |

Free + Uptime Kuma 運用なら:

```sh
pnpm run setup:ops -- --admin --access-guide
# 必要なら --notify（メール）または Notifications UI で Webhook
```

## 本番 URL

- 正式: `https://incident.thirdlf03.com`
- 代替: `*.workers.dev`（引き続き利用可）

## 関連

- [cloudflare-edge.md](./cloudflare-edge.md) — Turnstile、Access、Budget alert 手順
- [observability.md](./observability.md) — ログ、Logpush、推奨シグナル
- [load-test.md](./load-test.md) — 手動キャパシティ確認
