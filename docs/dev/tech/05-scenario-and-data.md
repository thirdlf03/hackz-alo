# tech: シナリオ定義とデータモデル

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 8. Scenario 定義

### 8.1 Schema

YAML を source とし、build 時または起動時に JSON schema / Zod で検証する。

```yaml
id: disk-full-001
version: 1
title: 'ログが世界を埋め尽くす夜'
difficulty: beginner
time_limit_minutes: 12

service:
  name: 'やまびこ API'
  health_url: 'http://localhost:3000/health'

sandbox:
  image: 'unyoh-mvp:2026-06-20' # やまびこ MVP イメージ（現行実装の識別子は unyoh-mvp のまま。移行予定）
  startup:
    - id: api
      command: 'node /workspace/services/unyoh-api/server.js'
      wait_for_port: 3000
    - id: fake-db
      command: 'node /workspace/services/fake-db/server.js'
      wait_for_port: 15432

triggers:
  - at_ms: 60000
    type: disk_full
    params:
      path: '/workspace/logs/debug.log'
      bytes: 838860800

alerts:
  - at_ms: 90000
    severity: critical
    message: 'HTTP 500 rate is above threshold'

success_conditions:
  - type: http_status
    url: 'http://localhost:3000/health'
    status: 200
  - type: disk_usage_below
    path: '/workspace'
    value_percent: 80
  - type: process_running
    process_id: 'api'
```

### 8.2 Success condition

success condition は player の「復旧完了」宣言時に評価する。常時評価も行い、UI に復旧の兆候は出すが、宣言前に自動 clear しない。

```ts
type SuccessCondition =
  | {type: 'http_status'; url: string; status: number}
  | {type: 'disk_usage_below'; path: string; valuePercent: number}
  | {type: 'process_running'; processId: string}
  | {type: 'log_absent'; path: string; pattern: string}
  | {type: 'unlang_batch_ok'; jobId: string};
```

### 8.3 Time model

game time は session start からの logical ms。

- scenario trigger: `at_ms`
- replay event: `at`
- video sync: `at / 1000`

一時停止を入れる場合は `pausedDurationMs` を差し引く。MVP ではプレイ中 pause なし。

## 9. データモデル

### 9.1 D1 tables

D1 は Worker binding から使い、prepared statement + bind を基本にする。D1 docs は binding 経由アクセス、prepared statement の `bind()`、`run()` を提供している [R13][R14]。

```sql
create table scenarios (
  id text not null,
  version integer not null,
  title text not null,
  difficulty text not null,
  manifest_object_key text not null,
  created_at text not null,
  primary key (id, version)
);

create table play_sessions (
  id text primary key,
  scenario_id text not null,
  scenario_version integer not null,
  sandbox_id text not null,
  replay_id text not null,
  status text not null,
  started_at text,
  finished_at text,
  result text,
  duration_ms integer,
  created_at text not null
);

create table replays (
  id text primary key,
  session_id text not null,
  scenario_id text not null,
  difficulty text not null,
  started_at text not null,
  finished_at text,
  duration_ms integer,
  result text,
  video_object_key text,
  event_log_object_key text,
  thumbnail_object_key text,
  browser_info_json text,
  recording_status text not null,
  mime_type text,
  created_at text not null,
  updated_at text not null
);

create table replay_chunks (
  replay_id text not null,
  seq integer not null,
  object_key text not null,
  byte_size integer not null,
  started_at_ms integer,
  ended_at_ms integer,
  sha256 text,
  uploaded_at text not null,
  primary key (replay_id, seq)
);

create table replay_events_index (
  replay_id text not null,
  event_id text not null,
  type text not null,
  at_ms integer not null,
  summary text,
  visibility text not null,
  primary key (replay_id, event_id)
);

create table replay_multipart_uploads (
  replay_id text primary key,
  object_key text not null,
  upload_id text not null,
  next_part_number integer not null,
  uploaded_parts_json text not null,
  status text not null,
  created_at text not null,
  updated_at text not null
);
```

### 9.2 D1 consistency

進行中セッションの強い一貫性が必要な state は Durable Object に寄せる。D1 は metadata 永続化に使う。複数 query の sequential consistency が必要な read path では D1 `withSession()` を検討する [R13]。

## 10. Event log

### 10.1 Event type

MVP event type:

```ts
type ReplayEventType =
  | 'session_start'
  | 'session_end'
  | 'scenario_event'
  | 'alert'
  | 'monitor_update'
  | 'terminal_input'
  | 'terminal_output'
  | 'command_detected'
  | 'ui_click'
  | 'ui_panel_open'
  | 'runbook_open'
  | 'slack_message_read' // 現行実装の識別子。`chat_message_read` へ改称予定
  | 'file_opened'
  | 'service_restart'
  | 'recovery_check'
  | 'incident_resolved'
  | 'player_note'
  | 'recording_chunk_created'
  | 'recording_error';
```

### 10.2 JSONL 保存

イベントは Durable Object で受け、短い buffer に貯め、一定件数または一定秒数で R2 object へ flush する。R2 object は追記 API ではないため、MVP は以下のどちらかにする。

推奨:

- `replays/{id}/events/{seq}.jsonl` として分割保存。
- session end で manifest `events-manifest.json` を作る。
- replay page は manifest に従って読む。

代替:

- Durable Object storage に event を蓄積し、終了時に 1 本の JSONL を R2 に put。
- 10-15 分 MVP なら成立しやすいが、通信断 partial replay には弱い。
