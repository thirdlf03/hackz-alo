export const defaultRecordingMimeTypes = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4"
] as const;

export function pickSupportedMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = defaultRecordingMimeTypes
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim() === "") continue;
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // Keep probing lower-priority candidates; browser MIME sniffing can be inconsistent.
    }
  }
  return undefined;
}

export const recordingChunkMs = 5000;
export const recordingMultipartPartSize = 8 * 1024 * 1024;
