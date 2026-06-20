const replayIdPattern = /^[a-zA-Z0-9_-]{6,80}$/;

export function assertReplayId(replayId: string): string {
  if (typeof replayId !== "string" || !replayIdPattern.test(replayId)) {
    throw new Error("invalid replayId");
  }
  return replayId;
}

export function replayVideoKey(replayId: string): string {
  return `replays/${assertReplayId(replayId)}/video.webm`;
}

export function replayChunkKey(replayId: string, seq: number): string {
  return `replays/${assertReplayId(replayId)}/chunks/${assertSeq(seq)}.webm`;
}

export function replayEventsKey(replayId: string, seq: number): string {
  return `replays/${assertReplayId(replayId)}/events/${assertSeq(seq)}.jsonl`;
}

export function replayEventsManifestKey(replayId: string): string {
  return `replays/${assertReplayId(replayId)}/events-manifest.json`;
}

export function replayThumbnailKey(replayId: string): string {
  return `replays/${assertReplayId(replayId)}/thumbnail.webp`;
}

function assertSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > 999999) {
    throw new Error("invalid sequence number");
  }
  return String(seq).padStart(6, "0");
}
