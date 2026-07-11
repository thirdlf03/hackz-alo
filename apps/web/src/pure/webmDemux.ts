import {filterImportantEvents} from './replayMedia.js';

/**
 * Minimal WebM (Matroska subset) demuxer for MediaRecorder output.
 *
 * MediaRecorder (Chrome) emits a simple structure:
 * EBML header → Segment → Info (TimecodeScale/Duration) → Tracks → Clusters.
 * Segment and Cluster may use the unknown-size vint (all value bits set), in
 * which case children are parsed sequentially until the next element that can
 * only appear at the parent level (or EOF).
 */

export interface WebmSample {
  timestampMs: number;
  keyframe: boolean;
  data: Uint8Array;
}

export interface DemuxedWebm {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  durationMs: number;
  samples: WebmSample[];
}

export interface HighlightWindow {
  id: string;
  label: string;
  eventAtMs: number;
  startMs: number;
  endMs: number;
}

interface HighlightSourceEvent {
  event_id: string;
  type: string;
  at_ms: number;
  summary?: string | null;
}

const idEbmlHeader = 0x1a45dfa3;
const idSegment = 0x18538067;
const idSeekHead = 0x114d9b74;
const idInfo = 0x1549a966;
const idTimecodeScale = 0x2ad7b1;
const idDuration = 0x4489;
const idTracks = 0x1654ae6b;
const idTrackEntry = 0xae;
const idTrackNumber = 0xd7;
const idTrackType = 0x83;
const idCodecId = 0x86;
const idVideo = 0xe0;
const idPixelWidth = 0xb0;
const idPixelHeight = 0xba;
const idCluster = 0x1f43b675;
const idClusterTimecode = 0xe7;
const idSimpleBlock = 0xa3;
const idBlockGroup = 0xa0;
const idBlock = 0xa1;
const idReferenceBlock = 0xfb;
const idCues = 0x1c53bb6b;
const idChapters = 0x1043a770;
const idTags = 0x1254c367;
const idAttachments = 0x1941a469;

/** Element IDs that terminate an unknown-size Cluster when encountered. */
const segmentLevelIds = new Set([
  idCluster,
  idCues,
  idSeekHead,
  idInfo,
  idTracks,
  idTags,
  idChapters,
  idAttachments,
  idSegment,
]);

const codecByCodecId = new Map<string, string>([
  ['V_VP8', 'vp8'],
  ['V_VP9', 'vp09.00.10.08'],
]);

const nsPerMs = 1_000_000;

interface EbmlVint {
  value: number | undefined;
  length: number;
}

interface EbmlElement {
  id: number;
  /** undefined = unknown-size element */
  size: number | undefined;
  dataStart: number;
}

/** Read an EBML element ID (marker bits kept, 1..4 bytes). */
function readElementId(
  bytes: Uint8Array,
  pos: number
): {id: number; length: number} | undefined {
  const first = bytes[pos];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length += 1;
    if (length > 4) return undefined;
  }
  if (pos + length > bytes.length) return undefined;
  let id = 0;
  for (let i = 0; i < length; i += 1) {
    id = id * 256 + (bytes[pos + i] ?? 0);
  }
  return {id, length};
}

/** Read an EBML vint value (marker bit stripped); unknown-size → value undefined. */
function readVint(bytes: Uint8Array, pos: number): EbmlVint | undefined {
  const first = bytes[pos];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length += 1;
    if (length > 8) return undefined;
  }
  if (pos + length > bytes.length) return undefined;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[pos + i] ?? 0;
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return {value: allOnes ? undefined : value, length};
}

function readElement(bytes: Uint8Array, pos: number): EbmlElement | undefined {
  const id = readElementId(bytes, pos);
  if (!id) return undefined;
  const size = readVint(bytes, pos + id.length);
  if (!size) return undefined;
  return {
    id: id.id,
    size: size.value,
    dataStart: pos + id.length + size.length,
  };
}

/** Iterate direct children of a known-size element range. */
function* iterateChildren(
  bytes: Uint8Array,
  start: number,
  end: number
): Generator<EbmlElement> {
  let pos = start;
  while (pos < end) {
    const element = readElement(bytes, pos);
    if (!element || element.size === undefined) return;
    if (element.dataStart + element.size > end) return;
    yield element;
    pos = element.dataStart + element.size;
  }
}

function readUint(bytes: Uint8Array, start: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) {
    value = value * 256 + (bytes[start + i] ?? 0);
  }
  return value;
}

function readFloat(view: DataView, start: number, size: number): number {
  if (size === 4) return view.getFloat32(start);
  if (size === 8) return view.getFloat64(start);
  return 0;
}

function readAscii(bytes: Uint8Array, start: number, size: number): string {
  let text = '';
  for (let i = 0; i < size; i += 1) {
    const byte = bytes[start + i] ?? 0;
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

interface ParsedInfo {
  timecodeScale: number;
  durationTicks: number;
}

function parseInfo(
  bytes: Uint8Array,
  view: DataView,
  info: EbmlElement
): ParsedInfo {
  let timecodeScale = nsPerMs;
  let durationTicks = 0;
  const end = info.dataStart + (info.size ?? 0);
  for (const child of iterateChildren(bytes, info.dataStart, end)) {
    const size = child.size ?? 0;
    if (child.id === idTimecodeScale) {
      const scale = readUint(bytes, child.dataStart, size);
      if (scale > 0) timecodeScale = scale;
    } else if (child.id === idDuration) {
      durationTicks = readFloat(view, child.dataStart, size);
    }
  }
  return {timecodeScale, durationTicks};
}

interface ParsedVideoTrack {
  trackNumber: number;
  codec: string;
  codedWidth: number;
  codedHeight: number;
}

function parseTracks(
  bytes: Uint8Array,
  tracks: EbmlElement
): ParsedVideoTrack | undefined {
  const end = tracks.dataStart + (tracks.size ?? 0);
  for (const entry of iterateChildren(bytes, tracks.dataStart, end)) {
    if (entry.id !== idTrackEntry) continue;
    const parsed = parseTrackEntry(bytes, entry);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseTrackEntry(
  bytes: Uint8Array,
  entry: EbmlElement
): ParsedVideoTrack | undefined {
  let trackNumber = 0;
  let trackType = 0;
  let codecId = '';
  let codedWidth = 0;
  let codedHeight = 0;
  const end = entry.dataStart + (entry.size ?? 0);
  for (const child of iterateChildren(bytes, entry.dataStart, end)) {
    const size = child.size ?? 0;
    if (child.id === idTrackNumber) {
      trackNumber = readUint(bytes, child.dataStart, size);
    } else if (child.id === idTrackType) {
      trackType = readUint(bytes, child.dataStart, size);
    } else if (child.id === idCodecId) {
      codecId = readAscii(bytes, child.dataStart, size);
    } else if (child.id === idVideo) {
      const videoEnd = child.dataStart + size;
      for (const videoChild of iterateChildren(
        bytes,
        child.dataStart,
        videoEnd
      )) {
        const videoSize = videoChild.size ?? 0;
        if (videoChild.id === idPixelWidth) {
          codedWidth = readUint(bytes, videoChild.dataStart, videoSize);
        } else if (videoChild.id === idPixelHeight) {
          codedHeight = readUint(bytes, videoChild.dataStart, videoSize);
        }
      }
    }
  }
  const codec = codecByCodecId.get(codecId);
  if (trackType !== 1 || trackNumber <= 0 || !codec) return undefined;
  if (codedWidth <= 0 || codedHeight <= 0) return undefined;
  return {trackNumber, codec, codedWidth, codedHeight};
}

interface RawBlock {
  trackNumber: number;
  timestampTicks: number;
  keyframe: boolean;
  data: Uint8Array;
}

/** Parse a (Simple)Block payload: vint track number, int16 relative timecode, flags. */
function parseBlockPayload(
  bytes: Uint8Array,
  start: number,
  end: number
):
  | {trackNumber: number; relTicks: number; flags: number; data: Uint8Array}
  | undefined {
  const trackVint = readVint(bytes, start);
  if (!trackVint || trackVint.value === undefined) return undefined;
  const pos = start + trackVint.length;
  if (pos + 3 > end) return undefined;
  const high = bytes[pos] ?? 0;
  const low = bytes[pos + 1] ?? 0;
  const relTicks = (((high << 8) | low) << 16) >> 16;
  const flags = bytes[pos + 2] ?? 0;
  // Lacing (flags 0x06) is not produced by MediaRecorder; skip laced blocks.
  if ((flags & 0x06) !== 0) return undefined;
  return {
    trackNumber: trackVint.value,
    relTicks,
    flags,
    data: bytes.subarray(pos + 3, end),
  };
}

function parseBlockGroup(
  bytes: Uint8Array,
  group: EbmlElement,
  clusterTimecode: number,
  blocks: RawBlock[]
): void {
  const end = group.dataStart + (group.size ?? 0);
  let hasReference = false;
  let block:
    | {trackNumber: number; relTicks: number; data: Uint8Array}
    | undefined;
  for (const child of iterateChildren(bytes, group.dataStart, end)) {
    const size = child.size ?? 0;
    if (child.id === idBlock) {
      block = parseBlockPayload(bytes, child.dataStart, child.dataStart + size);
    } else if (child.id === idReferenceBlock) {
      hasReference = true;
    }
  }
  if (!block) return;
  blocks.push({
    trackNumber: block.trackNumber,
    timestampTicks: clusterTimecode + block.relTicks,
    // A Block inside a BlockGroup is a keyframe iff there is no ReferenceBlock.
    keyframe: !hasReference,
    data: block.data,
  });
}

/** Parse one Cluster; returns the position after the cluster. */
function parseCluster(
  bytes: Uint8Array,
  cluster: EbmlElement,
  segmentEnd: number,
  blocks: RawBlock[]
): number {
  const unknownSize = cluster.size === undefined;
  const end = unknownSize
    ? segmentEnd
    : Math.min(segmentEnd, cluster.dataStart + (cluster.size ?? 0));
  let pos = cluster.dataStart;
  let clusterTimecode = 0;
  while (pos < end) {
    if (unknownSize) {
      const nextId = readElementId(bytes, pos);
      if (!nextId) return end;
      // An unknown-size Cluster ends where the next segment-level element starts.
      if (segmentLevelIds.has(nextId.id)) return pos;
    }
    const child = readElement(bytes, pos);
    if (!child || child.size === undefined) return end;
    const childEnd = child.dataStart + child.size;
    if (childEnd > end) return end;
    if (child.id === idClusterTimecode) {
      clusterTimecode = readUint(bytes, child.dataStart, child.size);
    } else if (child.id === idSimpleBlock) {
      const block = parseBlockPayload(bytes, child.dataStart, childEnd);
      if (block) {
        blocks.push({
          trackNumber: block.trackNumber,
          timestampTicks: clusterTimecode + block.relTicks,
          keyframe: (block.flags & 0x80) !== 0,
          data: block.data,
        });
      }
    } else if (child.id === idBlockGroup) {
      parseBlockGroup(bytes, child, clusterTimecode, blocks);
    }
    pos = childEnd;
  }
  return end;
}

export function demuxWebm(buffer: ArrayBuffer): DemuxedWebm | undefined {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const header = readElement(bytes, 0);
  if (!header || header.id !== idEbmlHeader || header.size === undefined) {
    return undefined;
  }
  const segment = readElement(bytes, header.dataStart + header.size);
  if (!segment || segment.id !== idSegment) return undefined;
  const segmentEnd =
    segment.size === undefined
      ? bytes.length
      : Math.min(bytes.length, segment.dataStart + segment.size);

  let timecodeScale = nsPerMs;
  let durationTicks = 0;
  let track: ParsedVideoTrack | undefined;
  const blocks: RawBlock[] = [];

  let pos = segment.dataStart;
  while (pos < segmentEnd) {
    const element = readElement(bytes, pos);
    if (!element) break;
    if (element.id === idCluster) {
      pos = parseCluster(bytes, element, segmentEnd, blocks);
      continue;
    }
    if (element.size === undefined) break;
    if (element.id === idInfo) {
      const info = parseInfo(bytes, view, element);
      timecodeScale = info.timecodeScale;
      durationTicks = info.durationTicks;
    } else if (element.id === idTracks && !track) {
      track = parseTracks(bytes, element);
    }
    pos = element.dataStart + element.size;
  }

  if (!track) return undefined;
  const videoTrackNumber = track.trackNumber;
  const ticksToMs = timecodeScale / nsPerMs;
  const samples = blocks
    .filter((block) => block.trackNumber === videoTrackNumber)
    .map((block) => ({
      timestampMs: Math.round(block.timestampTicks * ticksToMs),
      keyframe: block.keyframe,
      data: block.data,
    }))
    .toSorted((a, b) => a.timestampMs - b.timestampMs);
  const lastSample = samples[samples.length - 1];
  const durationMs =
    durationTicks > 0
      ? Math.round(durationTicks * ticksToMs)
      : (lastSample?.timestampMs ?? 0);
  return {
    codec: track.codec,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    durationMs,
    samples,
  };
}

/**
 * Decode range for a target timestamp: startIndex is the nearest keyframe at or
 * before the target, endIndex is the last sample at or before the target.
 */
export function findDecodeRange(
  samples: WebmSample[],
  targetMs: number
): {startIndex: number; endIndex: number} {
  if (samples.length === 0) return {startIndex: 0, endIndex: 0};
  let endIndex = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if ((samples[i]?.timestampMs ?? 0) > targetMs) break;
    endIndex = i;
  }
  let startIndex = endIndex;
  while (startIndex > 0 && !(samples[startIndex]?.keyframe ?? false)) {
    startIndex -= 1;
  }
  return {startIndex, endIndex};
}

/** Evenly spaced timestamps (segment centers) for filmstrip thumbnails. */
export function pickThumbnailTimestamps(
  durationMs: number,
  count: number
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  if (!Number.isFinite(count) || count <= 0) return [];
  const timestamps: number[] = [];
  for (let i = 0; i < count; i += 1) {
    timestamps.push(Math.round(((i + 0.5) / count) * durationMs));
  }
  return timestamps;
}

const highlightPrimaryTypes = new Set([
  'alert',
  'inject',
  'inject_fired',
  'scenario_event',
  'incident_resolved',
]);

function highlightLabel(event: HighlightSourceEvent): string {
  const summary = event.summary?.trim();
  if (summary) return summary;
  switch (event.type) {
    case 'alert':
      return 'アラート';
    case 'incident_resolved':
      return '復旧宣言';
    case 'command_detected':
      return 'コマンド実行';
    case 'inject':
    case 'inject_fired':
    case 'scenario_event':
      return 'インジェクト';
    case 'recovery_check':
      return '復旧チェック';
    case 'service_restart':
      return 'サービス再起動';
    case 'session_end':
      return 'セッション終了';
    default:
      return event.type;
  }
}

/**
 * Build highlight windows around important events (alert / inject fired /
 * incident_resolved etc., command_detected as fallback), clamp them to
 * [0, videoDurationMs], merge overlapping windows and cap the count.
 */
export function pickHighlightWindows(
  events: HighlightSourceEvent[],
  videoDurationMs: number,
  options?: {beforeMs?: number; afterMs?: number; max?: number}
): HighlightWindow[] {
  const beforeMs = options?.beforeMs ?? 4000;
  const afterMs = options?.afterMs ?? 2000;
  const max = options?.max ?? 5;
  if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0 || max <= 0) {
    return [];
  }
  const importantIds = new Set(
    filterImportantEvents(events).map((event) => event.event_id)
  );
  let pool = events.filter(
    (event) =>
      highlightPrimaryTypes.has(event.type) || importantIds.has(event.event_id)
  );
  if (pool.length === 0) {
    pool = events.filter((event) => event.type === 'command_detected');
  }
  // 録画が動画尺より先に終わっている場合(イベント時刻 > 動画尺)も
  // 末尾へクランプして拾う。クランプされた複数イベントは下のマージで
  // 1 つの「録画末尾」窓にまとまる。
  const sorted = pool
    .filter((event) => Number.isFinite(event.at_ms) && event.at_ms >= 0)
    .map((event) =>
      event.at_ms <= videoDurationMs
        ? event
        : {...event, at_ms: videoDurationMs}
    )
    .toSorted((a, b) => a.at_ms - b.at_ms);
  const windows: HighlightWindow[] = [];
  for (const event of sorted) {
    const startMs = Math.min(
      videoDurationMs,
      Math.max(0, event.at_ms - beforeMs)
    );
    const endMs = Math.min(videoDurationMs, Math.max(0, event.at_ms + afterMs));
    if (endMs <= startMs) continue;
    const last = windows[windows.length - 1];
    if (last && startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, endMs);
      if (!last.label.endsWith(' ほか')) last.label = `${last.label} ほか`;
      continue;
    }
    windows.push({
      id: `highlight-${event.event_id}`,
      label: highlightLabel(event),
      eventAtMs: event.at_ms,
      startMs,
      endMs,
    });
  }
  return windows.slice(0, max);
}
