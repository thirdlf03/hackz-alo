import {gamePalette} from './gamePalette.js';
import {
  clamp,
  normalizeMultilineText,
  shortenPath,
  withAlpha,
} from '../../pure/canvasMath.js';
import {
  extractTypedCommand,
  formatDifficulty,
  formatNarrativeClock,
  formatRecordingStatus,
  formatTerminalInputText,
  formatTime,
  metricTone,
  summarizeMetricsHealth,
  type MetricsHealthSummary,
} from '../../pure/canvasFormat.js';
import type {TerminalVisualLine} from '../../pure/terminalVisual.js';
import {
  emptyTerminalVisualLine,
  findTerminalCursorVisualLine,
  mirrorTerminalVisualLine,
} from '../../pure/terminalVisual.js';

const palette = gamePalette;

export type {TerminalVisualLine, MetricsHealthSummary};
export {
  clamp,
  shortenPath,
  withAlpha,
  normalizeMultilineText,
  formatTime,
  formatNarrativeClock,
  formatRecordingStatus,
  formatDifficulty,
  formatTerminalInputText,
  extractTypedCommand,
  metricTone,
  summarizeMetricsHealth,
  mirrorTerminalVisualLine,
  findTerminalCursorVisualLine,
  emptyTerminalVisualLine,
};

export function drawSparkline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  values: number[],
  color: string,
  scaleMax: number
) {
  if (width <= 0 || height <= 0 || values.length === 0) return;

  const peak = Math.max(scaleMax, ...values, 1);
  const points = values.map((value, index) => ({
    x:
      values.length === 1
        ? x + width / 2
        : x + (index / (values.length - 1)) * width,
    y: y + height - (Math.max(0, value) / peak) * (height - 2) - 1,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = palette.bgCard;
  ctx.fillRect(x, y, width, height);

  if (points.length === 1) {
    ctx.strokeStyle = withAlpha(color, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, first.y);
    ctx.lineTo(x + width, first.y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x, y + height);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(last.x, y + height);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & {width: number; height: number},
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;

  if (imageRatio > targetRatio) {
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

export function wrapCharacters(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    const candidate = `${line}${char}`;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = Number.POSITIVE_INFINITY
) {
  let drawn = 0;

  for (const paragraph of normalizeMultilineText(text).split('\n')) {
    if (drawn >= maxLines) return y;
    if (!paragraph.trim()) {
      y += lineHeight;
      drawn += 1;
      continue;
    }

    const listMatch = paragraph.trim().match(/^(\d+\.\s*)([\s\S]*)$/);
    if (listMatch) {
      const prefix = listMatch[1] ?? '';
      const body = listMatch[2] ?? '';
      const prefixWidth = ctx.measureText(prefix).width;
      const bodyWidth = Math.max(48, maxWidth - prefixWidth);
      const bodyLines = wrapCharacters(ctx, body, bodyWidth);

      for (let index = 0; index < bodyLines.length; index += 1) {
        if (drawn >= maxLines) return y;
        const segment = bodyLines[index] ?? '';
        if (index === 0) {
          ctx.fillText(`${prefix}${segment}`, x, y);
        } else {
          ctx.fillText(segment, x + prefixWidth, y);
        }
        y += lineHeight;
        drawn += 1;
      }
      continue;
    }

    const words = paragraph.includes(' ')
      ? paragraph.trim().split(/\s+/)
      : Array.from(paragraph.trim());
    const separator = paragraph.includes(' ') ? ' ' : '';
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line}${separator}${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        drawn += 1;
        if (drawn >= maxLines) return y;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      drawn += 1;
    }
  }

  return y;
}

export function drawMagnifyIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
) {
  ctx.save();
  ctx.fillStyle = palette.bgOverlayLight;
  roundRect(ctx, x - 2, y - 2, size + 4, size + 4, 4);
  ctx.fill();
  ctx.strokeStyle = palette.textSecondary;
  ctx.lineWidth = 1.5;
  const lensRadius = size * 0.34;
  const lensX = x + size * 0.38;
  const lensY = y + size * 0.38;
  ctx.beginPath();
  ctx.arc(lensX, lensY, lensRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lensX + lensRadius * 0.72, lensY + lensRadius * 0.72);
  ctx.lineTo(x + size - 2, y + size - 2);
  ctx.stroke();
  ctx.restore();
}

export function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let trimmed = text;
  while (
    trimmed.length > 0 &&
    ctx.measureText(`${trimmed}${ellipsis}`).width > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
}

export function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const metrics = ctx.measureText(text);
  ctx.fillText(text, x + (width - metrics.width) / 2, y + height / 2 + 10);
}

export function inputCaretX(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number
) {
  const trailingWhitespace = text.match(/[ \t]+$/u)?.[0] ?? '';
  const visibleText = trailingWhitespace
    ? text.slice(0, -trailingWhitespace.length)
    : text;
  const metrics = visibleText ? ctx.measureText(visibleText) : undefined;
  const visibleRight = metrics
    ? typeof metrics.actualBoundingBoxRight === 'number'
      ? metrics.actualBoundingBoxRight
      : metrics.width
    : 0;
  const whitespaceWidth = trailingWhitespace
    ? ctx.measureText(trailingWhitespace).width
    : 0;
  return startX + visibleRight + whitespaceWidth + 2;
}
