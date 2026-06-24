# Access Policy (Production)

本番 API の読み取り・書き込み境界の運用向け要約。実装の正本は worker の read policy helper と migration CHECK 制約。

## Replay visibility

| visibility | 読み取り                                                  |
| ---------- | --------------------------------------------------------- |
| `private`  | write token または read token が必要                      |
| `unlisted` | share link / read token が必要                            |
| `public`   | 認証なしで metadata / video / public-safe events を読める |

`featured` 一覧に出せるのは `public` replay のみ。

## Session access

- **Write token** — セッション作成時に一度だけ返却。terminal、editor、resolve、録画 upload に必要。
- **Read token** — 共有リンク発行で生成（hash のみ DB 保存）。active session の read route と replay read に使用可。

token なしで拒否する route:

- `GET /api/sessions/:id/events|clock|metrics|logs|storage|files|file|ws/terminal`
- private / unlisted replay の metadata、video、chunks、events、comments

## Share links

- `POST /api/replays/:id/share-links` は write token 必須
- TTL は bounded（デフォルト 48h）。期限と scope は structured log `replay_share_link_issued` に記録
- 共有 URL は read token を query に含む。ログや error payload に token 値を出さない

## Deploy verification

```sh
INCIDENT_WORKER_URL=https://incident.thirdlf03.com \
INCIDENT_SMOKE_TURNSTILE_TOKEN=<turnstile-test-token> \
pnpm run deploy:smoke
```

`/api/ready` に加え、Turnstile 付き session create と private replay の 401/200 を確認する。

## Related

- [privacy.md](./privacy.md) — 録画・保持・公開イベントの扱い
- [incident-response.md](./incident-response.md) — 漏洩疑い時の手順
