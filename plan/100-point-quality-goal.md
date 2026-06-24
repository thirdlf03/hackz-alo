# 100-Point Quality Goal

この文書は、このコードベースを「100点」と評価できる状態を明確に定義する。
100点は主観的な完成度ではなく、下記の受け入れ条件をすべて満たした状態とする。

## 100点の定義

本番公開されても、権限境界、データ保護、主要ユーザー導線、障害時運用、保守性の各リスクが自動テストと運用手順で継続的に検証されている状態。

以下の 5 領域がすべて `Done` になったら 100点と判定する。

1. replay/session の読み取りと書き込みの権限境界が一貫して強制されている。
2. 主要なゲーム導線と権限境界が e2e で検証されている。
3. 大きな責務集中が解消され、coupling audit が警告なしで通る。
4. API/DB/schema の契約が自動検証され、壊れた入力が静かに通らない。
5. 本番運用の cleanup、retention、deploy smoke、performance regression が自動または明文化された手順で保証されている。

## Non-Goals

- 新機能追加そのものは 100点条件に含めない。
- UI の見た目の好みやシナリオ内容の面白さは評価対象外とする。
- Cloudflare 有料プラン依存の監視機能は必須にしない。ただし代替手段は必要。

## Gate 1: Access Control and Privacy

### Goal

replay ID や session ID を知っているだけでは、private data、active session、terminal、録画データを読めない。

### Acceptance Criteria

- `replays.visibility` の意味を以下のように定義し、API で強制する。
  - `private`: 作成者相当の write token または read token が必要。
  - `unlisted`: 共有用 read token または明示的な share grant が必要。
  - `public`: 認証なしで読める。
  - `featured`: `public` replay のみ一覧に出せる。
- replay read policy helper を 1 か所に定義し、以下の route が必ず経由する。
  - `GET /api/replays/:replayId`
  - `GET /api/replays/:replayId/video`
  - `GET /api/replays/:replayId/chunks`
  - `GET /api/replays/:replayId/chunks/:seq`
  - `GET /api/replays/:replayId/events`
  - `GET /api/replays/:replayId/thumbnail`
  - `GET /api/replays/:replayId/comments`
  - `POST /api/replays/:replayId/comments`
- active session の読み取り route は session write token または dedicated read token を要求する。
  - `GET /api/sessions/:sessionId/events`
  - `GET /api/sessions/:sessionId/clock`
  - `GET /api/sessions/:sessionId/metrics`
  - `GET /api/sessions/:sessionId/logs`
  - `GET /api/sessions/:sessionId/storage`
  - `GET /api/sessions/:sessionId/files`
  - `GET /api/sessions/:sessionId/file`
  - `GET /api/sessions/:sessionId/ws/terminal`
- replay upload/write routes は既存の write token requirement を維持する。
- public replay events は `visibility = 'public_safe'` のみ返す。
- video/chunk/thumbnail/comment についても private replay では token なし 401/403 になる。
- share link を発行する場合は、共有範囲と期限が明示される。
- token は DB には hash のみ保存する。
- secret や token 値は structured logs、perf spans、error payload に出ない。

### Required Tests

- Unit: replay read policy matrix。
- Unit: session read policy matrix。
- E2E: private replay は token なしで metadata/video/events/comments が拒否される。
- E2E: share link または read token 付き replay は読める。
- E2E: active session terminal は token なしで拒否され、token ありで接続できる。

### Done

- `pnpm test`
- `pnpm run test:e2e`
- `pnpm run lint`
- `pnpm run typecheck`
- 上記 access-control tests が CI で必須実行される。

## Gate 2: End-to-End Product Confidence

### Goal

ユーザーが実際に使う主要導線が、sandbox、Worker、Vite UI、D1、R2 の境界をまたいで検証されている。

### Acceptance Criteria

- e2e は smoke ではなく、少なくとも以下の導線を検証する。
  - scenario select -> briefing -> start -> fault fires -> player action -> resolve success。
  - start -> premature resolve -> false resolve failure。
  - start -> terminal command input -> command event appears in replay timeline。
  - start -> terminal interrupt -> prompt recovery。
  - editor file open -> edit -> save -> sandbox file updated -> replay event recorded。
  - recording opt-out -> replay page shows timeline-only state。
  - recording save enabled -> replay video endpoint becomes readable under correct policy。
  - shared replay link opens standalone replay under correct policy。
- e2e は Docker/Sandbox dependency を前提に CI で実行される。
- Playwright failure artifact は trace、screenshot、test-results を保存する。
- flaky retry に頼らず、local で 2 consecutive runs が成功する。

### Required Tests

- `tests/e2e/game-success.spec.ts`
- `tests/e2e/game-failure.spec.ts`
- `tests/e2e/terminal.spec.ts`
- `tests/e2e/editor.spec.ts`
- `tests/e2e/replay-access.spec.ts`

### Done

- `pnpm run test:e2e` が上記導線を含んで全通する。
- CI の e2e job が必須 gate として通る。

## Gate 3: Maintainability and Coupling

### Goal

変更時の影響範囲が追いやすく、重要な orchestration class が責務を抱え込みすぎていない。

### Acceptance Criteria

- `pnpm run audit:coupling` が threshold over 0 件で通る。
- `SessionDurableObject.ts` は route dispatch と orchestration に限定される。
- Session Durable Object から以下を分離する。
  - lifecycle/alarm handling
  - SSE client hub
  - terminal/file handlers
  - metrics/log/storage handlers
  - finish/cleanup transaction
- `sandbox/runtime.ts` から以下を分離する。
  - lifecycle and preparation
  - process startup
  - terminal control
  - file API
  - metrics/log/storage readers
- public API の挙動を変えずに分割する。
- 分割後も state transition と sandbox cleanup のテストが残る。

### Required Tests

- Unit: lifecycle alarm deadline and timeout behavior。
- Unit: finish/cleanup calls persistence before sandbox destroy。
- Unit: SSE hub broadcasts snapshot/replay and cleans closed clients。
- Unit: sandbox file/path/metrics/log handlers。
- Audit: coupling threshold over 0 件。

### Done

- `pnpm run audit:coupling` が警告なし。
- `pnpm test`
- `pnpm run test:integration`
- `pnpm run test:e2e`

## Gate 4: API, DB, and Schema Contracts

### Goal

API input、API output、DB schema、shared types のずれを CI が検出する。

### Acceptance Criteria

- route request body parsing は共通 validation helper 経由に統一する。
- `request.json().catch(() => ({}))` の ad hoc parse は route 直下から原則なくす。
- replay event upload は shape、type、actor、visibility、payload size を validation する。
- DB access は必要列 select を基本とし、`select *` を避ける。
- migration CHECK enum と shared constants の同期テストを維持する。
- scenario data は build 前後で schema validation される。
- API error envelope は route ごとの例外で揺れない。
- body size limit は `Content-Length` なしの streaming body でも上限を保証する。

### Required Tests

- Unit: invalid request bodies return stable 400 envelope。
- Unit: oversized streaming body returns 413。
- Unit: replay event unknown type/actor/visibility is rejected or normalized by explicit rule。
- Unit: migration enum sync。
- Unit: scenario validation。
- Integration: protected routes reject malformed auth and malformed body independently。

### Done

- `pnpm test`
- `pnpm run test:integration`
- `pnpm run audit:schema-sync`
- No route-level ad hoc body parsing for protected/public API handlers except documented exceptions。

## Gate 5: Production Operations

### Goal

本番で起きる cleanup、retention、deploy、performance、observability の失敗を検知または復旧できる。

### Acceptance Criteria

- retention sweep の対象、失敗、削除件数が structured log で追える。
- stale session cleanup の対象、失敗、削除件数が structured log で追える。
- multipart upload cleanup の方針がある。
- replay purge は DB row と R2 object の整合性をテストする。
- deploy 後 smoke は `/api/ready` だけでなく、session create と replay access policy を確認する。
- perf regression job は critical regression では失敗扱いにする。
- Vite の production build で chunk size warning を解消するか、根拠付きで threshold を設定する。
- docs/production に rollback、retention、privacy、access policy、incident response がそろっている。

### Required Tests and Checks

- Unit: replay purge removes chunks/events/video/thumbnail/comment references consistently。
- Unit: stale session sweep handles missing DO/sandbox failures。
- Script: deploy smoke creates a session with Turnstile disabled only in non-production or with a test token path。
- Script: perf compare fails on configured critical regressions。
- Build: no unexplained Vite chunk warning。

### Done

- `pnpm run build`
- `pnpm run perf:bench`
- `pnpm run perf:compare`
- deploy smoke script documented and used by deploy workflow。
- production docs updated for the final policy。

## Final 100-Point Checklist

The codebase is 100 points only when every item below is true.

- [x] Gate 1 access-control and privacy criteria are complete.
- [x] Gate 2 e2e product confidence criteria are complete.
- [x] Gate 3 maintainability and coupling criteria are complete.
- [x] Gate 4 API/DB/schema contract criteria are complete.
- [x] Gate 5 production operations criteria are complete.
- [ ] `pnpm run build:scenarios` passes.
- [ ] `pnpm run check:sandbox-assets` passes.
- [ ] `pnpm run fmt:check` passes.
- [ ] `pnpm run lint` passes.
- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm run test:integration` passes.
- [ ] `pnpm run test:e2e` passes.
- [ ] `pnpm run audit:schema-sync` passes.
- [ ] `pnpm run audit:coupling` passes with 0 threshold-over files.
- [ ] `pnpm run perf:bench` passes.
- [ ] `pnpm run perf:compare` passes or has no critical regression.
- [ ] CI requires all non-optional gates before merge.
- [ ] There are no known high or medium security/privacy findings.
- [ ] There are no undocumented production operational risks.

## Suggested Execution Order

1. Implement Gate 1 first. Access-control mistakes are the highest-risk gap.
2. Add Gate 2 e2e tests for the access policy and core game journeys.
3. Refactor for Gate 3 after behavior is locked by tests.
4. Tighten Gate 4 validation once route boundaries are stable.
5. Finish Gate 5 operational checks and deploy workflow changes.

## Scoring After Partial Completion

- Gate 1 complete: expected score 90+.
- Gates 1 and 2 complete: expected score 93+.
- Gates 1, 2, and 3 complete: expected score 95+.
- Gates 1 through 4 complete: expected score 97+.
- All gates complete: 100.
