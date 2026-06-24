# Incident Response

本番インシデント時の初動手順。詳細 runbook は [runbook.md](./runbook.md)、アクセス境界は [access-policy.md](./access-policy.md)。

## Severity guide

| Level | 例                                                  | 初動                                          |
| ----- | --------------------------------------------------- | --------------------------------------------- |
| S1    | private replay / session data が token なしで読める | 即時ロールバック検討、秘密ローテーション      |
| S2    | 録画 upload 失敗率急増、Sandbox 全面 503            | 縮退運用、status 確認、容量制限               |
| S3    | 単一 replay 改ざん疑い、コスト急増                  | 個別 replay 調査、retention / rate limit 確認 |

## S1: suspected access-control break

1. `pnpm run deploy:smoke -- --ready-only` で ready のみ確認（本番変更を増やさない）
2. 再現手順をメモ: route、replayId/sessionId、token の有無、HTTP status
3. 直前 deploy があれば [runbook.md](./runbook.md) の Rollback を実行
4. `ADMIN_SECRET` / write token hash / read token をローテーション（必要なら replay を private のまま維持）
5. 修正 PR を Gate 1 integration / e2e で検証してから再 deploy

## S2: platform or sandbox outage

1. Cloudflare status と Workers / Containers ログを確認
2. `session_sweep_failed` / `sandbox_error` の structured log を検索
3. 新規 session create を一時停止する場合は Turnstile + rate limit で実質制限（専用 kill switch は未実装）
4. 復旧後 `pnpm run load-test` または `deploy:smoke` で smoke

## S3: replay integrity or cost

1. `X-Request-Id` と `replayId` で upload route ログを追跡
2. R2 prefix `replays/<replayId>/` と D1 `replay_chunks` の件数・サイズを照合
3. 改ざん疑いなら replay を非公開のまま保持し、必要なら手動 `purgeReplayStorage` 相当の削除を runbook 手順で実施
4. コスト急増時は [ops-notes.md](./ops-notes.md) の billing alert と retention sweep を確認

## Communication

- ユーザー向け: 障害中は録画保存・新規プレイに影響がある旨を簡潔に
- 内部: 時刻、影響範囲、rollback の有無、再発防止タスクを残す

## Post-incident

- [ ] root cause を runbook または ops-notes に 1 段落追記
- [ ] 再発防止テスト（unit / integration / e2e）があれば PR に含める
- [ ] deploy smoke を再実行して記録
