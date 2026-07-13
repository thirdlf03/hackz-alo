# tech: 録画とリプレイ

[`tech.md`](../../../tech.md)(技術方針の目次)からの分冊。仕様の正は [`youken.md`](../../../youken.md)。

## 4. Canvas 内録画設計

### 4.1 録画方式

録画対象は `gameCanvas` のみ。ブラウザ全体録画や `getDisplayMedia()` は使わない。

基本フロー:

```ts
const canvasStream = gameCanvas.captureStream(30);
const mimeType = pickSupportedMimeType();
const recorder = new MediaRecorder(canvasStream, {
  mimeType,
  videoBitsPerSecond,
});
recorder.start(5000);
```

`captureStream()` は canvas 内容の `MediaStream` を返す [R25]。`MediaRecorder` は `MediaStream` を録画し、`start(timeslice)` によって一定間隔の `dataavailable` event を発火できる [R26][R27]。

### 4.2 MIME type 選択

browser support 差異があるため、`MediaRecorder.isTypeSupported()` で決める [R28]。

推奨順:

```ts
const candidates = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];
```

`video/mp4` は対応 browser 差がある。MVP の正式対応 browser は Chrome / Edge / Firefox を優先し、Safari は `isTypeSupported` の結果で録画可否を表示する。

### 4.3 音声を録画する場合

alert 音も replay に残すなら、Web Audio API で録画用 audio stream を作る。`AudioContext` は audio node graph を管理する API で、`createMediaStreamDestination()` は録音・送信用の MediaStream destination を作れる [R30][R31]。

```ts
const audioContext = new AudioContext();
const audioDest = audioContext.createMediaStreamDestination();

const mixed = new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...audioDest.stream.getAudioTracks(),
]);

const recorder = new MediaRecorder(mixed, {mimeType});
```

注意:

- AudioContext は autoplay blocking の影響を受けるため、ユーザー操作後に開始する必要がある browser が多い。ブリーフィングの「開始」ボタンで `audioContext.resume()` する [R38]。
- MVP で音声が不要なら video only でよい。alert は視覚 overlay と event log で残す。

### 4.4 chunk upload と final video

MediaRecorder の `timeslice=5000` は「録画 chunk を 5 秒ごとに受け取る」ための設定であり、R2 multipart の part とは別物として扱う [R26][R27]。

保存は次の 2 系統にする。

1. raw chunk 保存
   - key: `replays/{replayId}/chunks/{seq}.webm`
   - 目的: 通信断・録画途中終了・partial replay・debug
   - D1: `replay_chunks` に `seq`, `objectKey`, `byteSize`, `startedAtMs`, `endedAtMs`, `sha256` を保存

2. final video 保存
   - key: `replays/{replayId}/video.webm`
   - 目的: 通常の `<video>` 再生、公開共有
   - 実装: R2 multipart upload
   - 重要: R2 multipart は part を upload し、最後に `complete(uploadedParts)` する [R10]。part は原則同じサイズ、最後だけ小さくできる [R10]。Cloudflare の例では 5 MB が最小 part size と説明されている [R11]。

ブラウザ側の buffer 方針:

```txt
MediaRecorder 5s Blob
  -> raw chunk upload
  -> append bytes to mpuBuffer
  -> while mpuBuffer >= 8MiB:
       upload fixed-size part
  -> on stop:
       upload final leftover part
       complete multipart upload
```

8 MiB は例。Cloudflare の sample は 10 MB part を使っている [R11]。MVP では `RECORDING_MPU_PART_SIZE=8MiB` または `10MiB` を環境変数で固定する。

### 4.5 録画 state machine

```txt
idle
  -> consent_required
  -> initializing
  -> recording
  -> stopping
  -> finalizing
  -> ready

error states:
  recording_error
  upload_degraded
  finalization_failed
  unsupported_browser
```

録画失敗時の扱い:

- `MediaRecorder` 作成失敗: replay video なし。event log は継続。
- chunk upload 失敗: IndexedDB に一時保存し retry。retry 不能なら `upload_degraded`。
- final video complete 失敗: raw chunks から partial replay を提供。
- tab close: `visibilitychange`, `pagehide` で best effort flush。完全保証はしない。

### 4.6 thumbnail

結果画面用 thumbnail は scenario 終了時に canvas から `toBlob("image/webp")` で生成し、R2 に保存する。origin-clean 問題があるため、録画時と同じ asset policy を守る [R25]。

## 5. Replay 設計

### 5.1 Replay page の構成

Replay page は DOM UI でよい。録画対象ではない。

表示:

- `<video controls src="/api/replays/{id}/video">`
- timeline
- alerts
- command list
- runbook list
- important events

動画と timeline は `video.currentTime` と event `at` を同期する。

```ts
function seekToEvent(event: ReplayEvent) {
  video.currentTime = event.at / 1000;
}
```

### 5.2 event log と動画の同期

event log の `at` は session start からの monotonic milliseconds とする。`Date.now()` だけに依存せず、browser では `performance.now()`、server では session DO の logical clock を使う。

event log record:

```ts
type ReplayEvent = {
  id: string;
  replayId: string;
  type: ReplayEventType;
  at: number;
  wallTime?: string;
  actor: 'player' | 'system' | 'scenario' | 'sandbox';
  payload: Record<string, unknown>;
  visibility: 'public_safe' | 'private' | 'sensitive';
};
```

R2 保存形式は JSONL。

```jsonl
{"id":"evt_001","type":"session_start","at":0,"actor":"system","payload":{"scenarioId":"disk-full-001"}}
{"id":"evt_002","type":"alert","at":12000,"actor":"scenario","payload":{"message":"HTTP 500 rate is above threshold"}}
```

### 5.3 partial replay

final video がない場合は、raw chunk manifest から再生する。

MVP fallback:

1. chunk list を取得する。
2. browser が chunk を順番に fetch する。
3. `new Blob(chunks, { type: mimeType })` で object URL を作る。
4. `<video src={URL.createObjectURL(blob)}>` で再生する。

`URL.createObjectURL()` は Blob 用 URL を作成できる [R33]。長時間動画ではメモリを使うため、completed replay は final video を優先する。

将来改善:

- MediaSource Extensions で chunk append。
- async assembly Worker / queue で final object を生成。
- Range request 対応の単一 final object を標準にする。
