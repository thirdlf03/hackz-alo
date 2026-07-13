# tech: 実装順・拡張・参照元

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 17. MVP 実装順

> 注記: 本章は初期実装時の計画。現状のステータスは youken.md「現状ステータスとロードマップ」節を参照。

1. Project scaffold
   - Vite + Preact + TypeScript
   - Hono Worker
   - wrangler bindings stub

2. Scenario schema
   - YAML loader
   - 16 scenarios(beginner 3 / intermediate 9 / advanced 4。当初計画は 3 本)
   - runbook data

3. Sandbox image
   - unyoh-api
   - fake-db
   - log files
   - unlang CLI
   - fault injector

4. Session DO
   - create/start/finish
   - scenario clock
   - alert broadcast
   - success condition evaluation

5. Terminal
   - xterm.js connection
   - Sandbox terminal WebSocket
   - terminal mirror into canvas
   - command detection

6. Game canvas
   - triple monitor renderer
   - metrics panel
   - terminal panel
   - runbook/チャット panel
   - cursor/click effects
   - REC overlay

7. Recording
   - captureStream
   - MediaRecorder
   - chunk upload
   - R2 raw chunk storage
   - R2 multipart final video
   - failure fallback

8. Replay
   - video playback
   - JSONL timeline
   - command/alert/runbook list
   - seek sync

9. Security hardening
   - command allowlist for backend exec
   - R2 key validation

10. Tests and load check

- unit/integration/browser
- 15 min recording test
- sandbox cleanup test

## 19. 拡張(実装済み・将来)

### 19.1 Multiplayer(実装済み: Exercise Room)

当初「将来拡張」として置いていた multiplayer は Exercise Room として実装済み(`apps/worker/src/pure/exerciseRoom.ts`、Durable Object 上)。roles は `incident_commander` / `ops` / `scribe` / `comms` / `facilitator` / `observer` の6種。room state として参加者 presence、task、inject、incident log、hotwash note、after-action report を保持する。WebSocket hibernation を使う場合は attachment と storage で connection state を復元する [R8]。

### 19.2 DevTools 風 UI

実 Chrome DevTools を埋め込むのではなく、Network / Console / Application 風 panel を自前実装する。source は sandbox app の request log、browser-side simulated storage、server logs。MVP は HTTP request log viewer で代替する。

### 19.3 Replay comment

`replay_comments` table を追加し、`at_ms` に紐づく comment を保存する。動画 seek と同期する。

### 19.4 Scenario marketplace

scenario package を immutable object として R2 に保存し、D1 に version metadata を持つ。review 済み scenario のみ production に出す。

## 21. 参照元一覧

この一覧は本書作成時に確認した一次情報・公式資料。文中の `[Rxx]` は下記に対応する。

### 要件

- [R0] [youken.md](./youken.md)

### Cloudflare Sandbox / Containers

- [R1] [Cloudflare Sandbox SDK Overview](https://developers.cloudflare.com/sandbox/)
- [R2] [Cloudflare Sandbox SDK - Commands](https://developers.cloudflare.com/sandbox/api/commands/)
- [R3] [Cloudflare Sandbox SDK - Terminal](https://developers.cloudflare.com/sandbox/api/terminal/)
- [R4] [Cloudflare Sandbox SDK - Security model](https://developers.cloudflare.com/sandbox/concepts/security/)
- [R5] [Cloudflare Sandbox SDK - Limits](https://developers.cloudflare.com/sandbox/platform/limits/)
- [R6] [Cloudflare Containers Overview](https://developers.cloudflare.com/containers/)
- [R34] [Cloudflare Sandbox SDK llms.txt](https://developers.cloudflare.com/sandbox/llms.txt)
- [R35] [Cloudflare Sandbox SDK - Stream output](https://developers.cloudflare.com/sandbox/guides/streaming-output/)

### Cloudflare Workers / Durable Objects / Storage

- [R7] [Cloudflare Durable Objects Overview](https://developers.cloudflare.com/durable-objects/)
- [R8] [Cloudflare Durable Objects - Use WebSockets / Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [R9] [Cloudflare Workers - WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [R10] [Cloudflare R2 - Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R11] [Cloudflare R2 - Use the R2 multipart API from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [R12] [Cloudflare D1 Overview](https://developers.cloudflare.com/d1/)
- [R13] [Cloudflare D1 - D1 Database Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R14] [Cloudflare D1 - Prepared statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [R15] [Cloudflare Workers KV Overview](https://developers.cloudflare.com/kv/)
- [R16] [Cloudflare Workers KV - Read key-value pairs](https://developers.cloudflare.com/kv/api/read-key-value-pairs/)

### Hono

- [R17] [Hono - Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [R18] [Hono - WebSocket Helper](https://hono.dev/docs/helpers/websocket)
- [R36] [Hono - Hono Stacks](https://hono.dev/docs/concepts/stacks)
- [R37] [Hono - Context API](https://hono.dev/docs/api/context)

### Frontend framework / build / typing

- [R19] [Preact Guide - Differences to React](https://preactjs.com/guide/v10/differences-to-react/)
- [R20] [Preact Guide - TypeScript](https://preactjs.com/guide/v10/typescript/)
- [R21] [Vite Guide](https://vite.dev/guide/)
- [R22] [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

### xterm.js

- [R23] [xterm.js - Using addons](https://xtermjs.org/docs/guides/using-addons/)
- [R24] [xterm.js - Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)

### Browser APIs / MDN

- [R25] [MDN - HTMLCanvasElement.captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [R26] [MDN - MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [R27] [MDN - MediaRecorder dataavailable event](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)
- [R28] [MDN - MediaRecorder.isTypeSupported()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [R29] [MDN - Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [R30] [MDN - AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)
- [R31] [MDN - AudioContext.createMediaStreamDestination()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination)
- [R32] [MDN - MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)
- [R33] [MDN - URL.createObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
- [R38] [MDN - Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
