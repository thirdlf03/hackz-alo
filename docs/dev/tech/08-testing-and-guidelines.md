# tech: テストと実装ガイドライン

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 16. Testing

### 16.1 Unit tests

- scenario YAML validation
- trigger scheduling
- success condition evaluation
- event log schema
- kodama lexer/parser/evaluator
- R2 key generation
- MIME type selection

### 16.2 Integration tests

- Hono route + D1/R2 binding
- Session DO lifecycle
- Sandbox command wrapper with fake sandbox
- recording upload API idempotency
- replay metadata creation

Cloudflare Workers のテストは Hono docs が `@cloudflare/vitest-pool-workers` を推奨している [R17]。

### 16.3 Browser tests

Playwright で確認:

- gameCanvas が blank でない。
- REC overlay が入る。
- terminal input が canvas に描画される。
- `MediaRecorder.isTypeSupported()` fallback が働く。
- 5 秒 chunk が upload される。
- result page の video と timeline が同期する。

### 16.4 Manual compatibility matrix

| Browser        | 必須確認                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| Chrome stable  | WebM VP9/VP8, canvas capture, xterm, upload                               |
| Edge stable    | Chrome と同等                                                             |
| Firefox stable | WebM, MediaRecorder chunk, xterm                                          |
| Safari         | `video/mp4` / MediaRecorder support。未対応なら event log replay のみ表示 |

## 18. 技術リスクと対策

| リスク                                    | 影響                                 | 対策                                             |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| xterm.js DOM が canvas 録画に入らない     | replay に terminal が映らない        | terminal mirror を canvas に描画する             |
| canvas が origin tainted                  | `captureStream()` / thumbnail が失敗 | asset を same-origin/CORS 設定に統一             |
| MediaRecorder codec 差異                  | 録画不可 browser が出る              | `isTypeSupported()` fallback と録画なし mode     |
| R2 multipart part size                    | final video complete 失敗            | fixed-size byte buffer で part 化                |
| tab close で upload 未完了                | replay 欠損                          | raw chunk + IndexedDB retry + partial replay     |
| KV stale read                             | live session state が古い            | KV を static cache に限定                        |
| Sandbox cost/cold start                   | セッション開始が遅い                 | briefing 中に warm up、MVP は session 数制限     |
| Worker subrequest limit                   | metrics polling/command 多発で失敗   | DO で集約、polling 間隔制限、Sandbox 内 exporter |
| replay 共有で入力内容露出                 | privacy issue                        | preview、warning、redaction flag                 |
| full-screen terminal app の mirror 不完全 | replay 表示ずれ                      | MVP は必要操作を line-oriented command に寄せる  |

## 20. 実装時の Do / Don't

Do:

- 録画に残したいものは `GameRenderState` に入れる。
- `MediaRecorder` の MIME type は必ず runtime 判定する。
- recording chunk と R2 multipart part を分けて考える。
- live session state は Durable Object に置く。
- D1 は prepared statement を使う。
- sandbox には本物の secret を入れない。

Don't:

- DOM にだけ重要 UI を表示しない。
- `getDisplayMedia()` でブラウザ全体録画に逃げない。
- user input を shell command に直接埋め込まない。
- KV を進行中 session の truth にしない。
- R2 bucket を雑に public にしない。
- 録画失敗でプレイ全体を落とさない。
