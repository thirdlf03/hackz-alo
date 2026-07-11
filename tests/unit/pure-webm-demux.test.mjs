import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  demuxWebm,
  findDecodeRange,
  pickThumbnailTimestamps,
  pickHighlightWindows,
} = await tsImport('../../apps/web/src/pure/webmDemux.ts', import.meta.url);

// --- EBML construction helpers -------------------------------------------

/** Encode an EBML size vint (1 or 2 bytes). */
function ebmlSize(length) {
  if (length < 0x7f) return [0x80 | length];
  if (length < 0x3fff) return [0x40 | (length >> 8), length & 0xff];
  throw new Error(`size too large for test helper: ${length}`);
}

/** Build one EBML element from raw id bytes + payload bytes. */
function ebml(idBytes, payload) {
  return [...idBytes, ...ebmlSize(payload.length), ...payload];
}

/** Big-endian unsigned int bytes of a fixed length. */
function uintBytes(value, length) {
  const bytes = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes.push((value >> (8 * i)) & 0xff);
  }
  return bytes;
}

function float64Bytes(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  return [...new Uint8Array(buffer)];
}

function asciiBytes(text) {
  return [...text].map((char) => char.charCodeAt(0));
}

/** SimpleBlock payload for track 1: vint track, int16 rel timecode, flags. */
function simpleBlock(relTicks, flags, frameBytes) {
  return ebml(
    [0xa3],
    [0x81, (relTicks >> 8) & 0xff, relTicks & 0xff, flags, ...frameBytes]
  );
}

function buildSyntheticWebm() {
  const ebmlHeader = ebml(
    [0x1a, 0x45, 0xdf, 0xa3],
    ebml([0x42, 0x82], asciiBytes('webm'))
  );
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    [
      // TimecodeScale = 1,000,000 ns → 1ms ticks
      ...ebml([0x2a, 0xd7, 0xb1], uintBytes(1_000_000, 3)),
      // Duration = 5000 ticks (float)
      ...ebml([0x44, 0x89], float64Bytes(5000)),
    ]
  );
  const trackEntry = ebml(
    [0xae],
    [
      ...ebml([0xd7], [0x01]), // TrackNumber = 1
      ...ebml([0x83], [0x01]), // TrackType = video
      ...ebml([0x86], asciiBytes('V_VP9')), // CodecID
      ...ebml(
        [0xe0],
        [
          ...ebml([0xb0], uintBytes(1920, 2)), // PixelWidth
          ...ebml([0xba], uintBytes(1080, 2)), // PixelHeight
        ]
      ),
    ]
  );
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], trackEntry);
  // BlockGroup with a Block and a ReferenceBlock → NOT a keyframe.
  const blockGroup = ebml(
    [0xa0],
    [
      ...ebml([0xa1], [0x81, 0x00, 0x50, 0x00, 9, 9]), // rel 80, frame [9, 9]
      ...ebml([0xfb], [0x7f]), // ReferenceBlock present
    ]
  );
  // First cluster uses the unknown-size vint (0xff), as MediaRecorder does.
  const cluster1 = [
    0x1f,
    0x43,
    0xb6,
    0x75,
    0xff,
    ...ebml([0xe7], uintBytes(1000, 2)), // Cluster Timecode = 1000
    ...simpleBlock(0, 0x80, [1, 2, 3]), // keyframe @1000
    ...simpleBlock(40, 0x00, [4, 5]), // delta @1040
    ...blockGroup, // delta @1080
  ];
  // Second cluster (known size) must terminate the unknown-size cluster.
  const cluster2 = ebml(
    [0x1f, 0x43, 0xb6, 0x75],
    [
      ...ebml([0xe7], uintBytes(2000, 2)),
      ...simpleBlock(0, 0x80, [7, 8]), // keyframe @2000
    ]
  );
  // Segment also uses the unknown-size vint.
  const segment = [
    0x18,
    0x53,
    0x80,
    0x67,
    0xff,
    ...info,
    ...tracks,
    ...cluster1,
    ...cluster2,
  ];
  return Uint8Array.from([...ebmlHeader, ...segment]).buffer;
}

// --- demuxWebm -------------------------------------------------------------

test('demuxWebm parses MediaRecorder-style WebM with unknown-size elements', () => {
  const demuxed = demuxWebm(buildSyntheticWebm());
  assert.ok(demuxed);
  assert.equal(demuxed.codec, 'vp09.00.10.08');
  assert.equal(demuxed.codedWidth, 1920);
  assert.equal(demuxed.codedHeight, 1080);
  assert.equal(demuxed.durationMs, 5000);
  assert.equal(demuxed.samples.length, 4);
  assert.deepEqual(
    demuxed.samples.map((sample) => sample.timestampMs),
    [1000, 1040, 1080, 2000]
  );
  assert.deepEqual(
    demuxed.samples.map((sample) => sample.keyframe),
    [true, false, false, true]
  );
  assert.deepEqual([...demuxed.samples[0].data], [1, 2, 3]);
  assert.deepEqual([...demuxed.samples[1].data], [4, 5]);
  assert.deepEqual([...demuxed.samples[2].data], [9, 9]);
  assert.deepEqual([...demuxed.samples[3].data], [7, 8]);
});

test('demuxWebm maps V_VP8 to the vp8 codec string', () => {
  const buffer = buildSyntheticWebm();
  const bytes = new Uint8Array(buffer);
  const needle = asciiBytes('V_VP9');
  const index = [...bytes].findIndex((_, i) =>
    needle.every((byte, j) => bytes[i + j] === byte)
  );
  assert.ok(index > 0);
  bytes.set(asciiBytes('V_VP8'), index);
  const demuxed = demuxWebm(buffer);
  assert.ok(demuxed);
  assert.equal(demuxed.codec, 'vp8');
});

test('demuxWebm returns undefined for garbage and for tracks-less input', () => {
  assert.equal(demuxWebm(Uint8Array.from([1, 2, 3, 4]).buffer), undefined);
  assert.equal(demuxWebm(new ArrayBuffer(0)), undefined);
  // Valid EBML header + Segment but no video track.
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], []);
  const segment = ebml(
    [0x18, 0x53, 0x80, 0x67],
    ebml([0x15, 0x49, 0xa9, 0x66], [])
  );
  assert.equal(
    demuxWebm(Uint8Array.from([...header, ...segment]).buffer),
    undefined
  );
});

// --- findDecodeRange --------------------------------------------------------

test('findDecodeRange resolves keyframe start and last-sample end', () => {
  const demuxed = demuxWebm(buildSyntheticWebm());
  const samples = demuxed.samples;
  assert.deepEqual(findDecodeRange(samples, 1085), {
    startIndex: 0,
    endIndex: 2,
  });
  assert.deepEqual(findDecodeRange(samples, 1040), {
    startIndex: 0,
    endIndex: 1,
  });
  assert.deepEqual(findDecodeRange(samples, 2500), {
    startIndex: 3,
    endIndex: 3,
  });
  assert.deepEqual(findDecodeRange(samples, 500), {startIndex: 0, endIndex: 0});
  assert.deepEqual(findDecodeRange([], 1000), {startIndex: 0, endIndex: 0});
});

// --- pickThumbnailTimestamps -------------------------------------------------

test('pickThumbnailTimestamps returns evenly spaced segment centers', () => {
  assert.deepEqual(
    pickThumbnailTimestamps(10_000, 4),
    [1250, 3750, 6250, 8750]
  );
  const ten = pickThumbnailTimestamps(60_000, 10);
  assert.equal(ten.length, 10);
  assert.equal(ten[0], 3000);
  assert.equal(ten[9], 57_000);
  for (let i = 1; i < ten.length; i += 1) {
    assert.equal(ten[i] - ten[i - 1], 6000);
  }
  assert.deepEqual(pickThumbnailTimestamps(0, 10), []);
  assert.deepEqual(pickThumbnailTimestamps(10_000, 0), []);
});

// --- pickHighlightWindows ----------------------------------------------------

const event = (id, type, atMs, summary = null) => ({
  event_id: id,
  type,
  at_ms: atMs,
  summary,
});

test('pickHighlightWindows filters to important events and clamps windows', () => {
  const windows = pickHighlightWindows(
    [
      event('e1', 'alert', 1000, 'CPU急騰'),
      event('e2', 'monitor_update', 8000),
      event('e3', 'incident_resolved', 59_000),
      event('e4', 'command_detected', 30_000),
    ],
    60_000
  );
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    id: 'highlight-e1',
    label: 'CPU急騰',
    eventAtMs: 1000,
    startMs: 0, // clamped from -3000
    endMs: 3000,
  });
  assert.deepEqual(windows[1], {
    id: 'highlight-e3',
    label: '復旧宣言',
    eventAtMs: 59_000,
    startMs: 55_000,
    endMs: 60_000, // clamped from 61_000
  });
});

test('pickHighlightWindows merges overlapping windows and keeps first label', () => {
  const windows = pickHighlightWindows(
    [
      event('e1', 'alert', 10_000, '最初のアラート'),
      event('e2', 'alert', 12_000, '二個目'),
      event('e3', 'alert', 13_000, '三個目'),
      event('e4', 'alert', 40_000),
    ],
    60_000
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0].label, '最初のアラート ほか');
  assert.equal(windows[0].startMs, 6000);
  assert.equal(windows[0].endMs, 15_000);
  assert.equal(windows[0].eventAtMs, 10_000);
  assert.equal(windows[1].label, 'アラート');
  assert.equal(windows[1].startMs, 36_000);
});

test('pickHighlightWindows caps count and honors custom options', () => {
  const events = [];
  for (let i = 0; i < 10; i += 1) {
    events.push(event(`e${i}`, 'alert', 10_000 * (i + 1)));
  }
  const capped = pickHighlightWindows(events, 200_000);
  assert.equal(capped.length, 5);
  const custom = pickHighlightWindows(events, 200_000, {
    beforeMs: 1000,
    afterMs: 500,
    max: 2,
  });
  assert.equal(custom.length, 2);
  assert.equal(custom[0].startMs, 9000);
  assert.equal(custom[0].endMs, 10_500);
});

test('pickHighlightWindows falls back to command_detected and drops out-of-range', () => {
  const windows = pickHighlightWindows(
    [
      event('c1', 'command_detected', 5000, 'systemctl restart nginx'),
      event('c2', 'command_detected', 90_000),
      event('m1', 'monitor_update', 2000),
    ],
    60_000
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0].id, 'highlight-c1');
  assert.equal(windows[0].label, 'systemctl restart nginx');

  assert.deepEqual(
    pickHighlightWindows([event('m1', 'monitor_update', 2000)], 60_000),
    []
  );
  assert.deepEqual(pickHighlightWindows([event('e1', 'alert', 1000)], 0), []);
});
