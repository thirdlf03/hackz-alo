export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function shortenPath(path: string, maxChars: number) {
  if (path.length <= maxChars) return path;
  return `...${path.slice(-(maxChars - 3))}`;
}

export function withAlpha(color: string, alpha: number) {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? `#${color.charAt(1)}${color.charAt(1)}${color.charAt(2)}${color.charAt(2)}${color.charAt(3)}${color.charAt(3)}`
        : color;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
  }
  return color;
}

export function normalizeMultilineText(text: string) {
  return text.replace(/\\n/g, '\n');
}
