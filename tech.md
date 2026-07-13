# 障害対応訓練シミュレーション 技術調査・設計書

調査日: 2026-06-20  
対象要件: [youken.md](./youken.md)  
目的: 要件定義に出てくる技術要素を、実装時に迷わない粒度まで分解する。

## 0. 結論

MVP は Cloudflare Workers + Hono + Durable Objects + D1 + R2 + Cloudflare Sandbox を中心に組む。フロントエンドは Preact + TypeScript + Vite、ターミナルは xterm.js、録画は `HTMLCanvasElement.captureStream()` + `MediaRecorder` を使う。

最も重要な設計判断は、「操作 UI」と「録画 UI」を分離しないこと。要件では録画対象を canvas 内に限定しているため、ユーザーが見ているゲーム画面の主要情報は必ず canvas に描画されている必要がある。xterm.js や Runbook などの DOM UI をそのまま置くだけでは録画に入らない。したがって MVP では、DOM は入力・アクセシビリティ・補助 UI に限定し、録画用 `gameCanvas` が最終的な画面表現を持つ。xterm.js の表示内容も、terminal buffer / 入出力イベントから canvas に再描画する。根拠は canvas capture が canvas の内容だけを MediaStream 化する仕様であること [R25]、xterm.js が terminal buffer と render/update event を提供すること [R24]。

録画保存は 2 層にする。5 秒ごとの `MediaRecorder` chunk は復旧用・partial replay 用に R2 へ chunk object として保存する。一方、結果画面で通常再生する最終動画は R2 multipart upload で 1 つの `video.webm` にまとめる。R2 multipart は各 part のサイズ制約があるため、MediaRecorder の 5 秒 chunk をそのまま multipart part として扱わず、ブラウザ側で固定サイズ byte part に再構成して upload する [R10][R11]。

リアルタイム状態は Durable Object が持つ。D1 は永続 metadata、R2 は動画・event log、KV は静的 scenario/runbook のキャッシュに限定する。KV は読み取りが一時的に古くなる可能性があるため、進行中セッションの真実の状態には使わない [R16]。Durable Objects は stateful coordination と WebSocket 接続の集約に向いている [R7][R8]。

Cloudflare Sandbox はプレイセッションごとに分離する。Sandbox SDK は VM-level isolation を提供するが、アプリケーション側で入力検証・rate limiting を実装する必要がある [R4]。ユーザー入力を backend-generated command に混ぜる場合は、command string へ直接埋め込まず、stdin / file API / allowlist を使う [R2][R4]。

## 目次(分冊)

本文はトピック別に `docs/dev/tech/` へ分冊した。文中の `[Rn]` は参照元番号で、一覧は「実装順・拡張・参照元」の分冊末尾(21. 参照元一覧)にある。

| 分冊                                                                                | 含まれる節                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [スタックと全体アーキテクチャ](docs/dev/tech/01-stack-and-architecture.md)          | 1. 採用スタック / 2. 全体アーキテクチャ                              |
| [Frontend 設計](docs/dev/tech/02-frontend.md)                                       | 3. Frontend 設計                                                     |
| [録画とリプレイ](docs/dev/tech/03-recording-and-replay.md)                          | 4. Canvas 内録画設計 / 5. Replay 設計                                |
| [Backend と Sandbox](docs/dev/tech/04-backend-and-sandbox.md)                       | 6. Backend 設計 / 7. Cloudflare Sandbox 設計                         |
| [シナリオ定義とデータモデル](docs/dev/tech/05-scenario-and-data.md)                 | 8. Scenario 定義 / 9. データモデル / 10. Event log                   |
| [可観測性と「こだま」](docs/dev/tech/06-observability-and-kodama.md)                | 11. Metrics / Logs / Alerts / 12. こだま                             |
| [セキュリティ・性能・可用性](docs/dev/tech/07-security-performance-availability.md) | 13. Security / 14. Performance / 15. Availability / Failure handling |
| [テストと実装ガイドライン](docs/dev/tech/08-testing-and-guidelines.md)              | 16. Testing / 18. 技術リスクと対策 / 20. 実装時の Do / Don't         |
| [実装順・拡張・参照元](docs/dev/tech/09-roadmap-and-references.md)                  | 17. MVP 実装順 / 19. 拡張(実装済み・将来) / 21. 参照元一覧           |
