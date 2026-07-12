import type {GameRenderState} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {parseAnsiLine, stripAnsi} from '../terminal/ansi.js';
import {
  emptyTerminalVisualLine,
  findTerminalCursorVisualLine,
  mirrorTerminalVisualLine,
  roundRect,
  shortenPath,
  wrapText,
  centeredText,
  type TerminalVisualLine,
} from './canvasDrawUtils.js';
import {gamePalette as palette, uiFont, monoFont} from './gamePalette.js';
import {
  centerToolTabRegions,
  monitorLayout,
  PANEL_HEADER_TEXT_RIGHT_MARGIN,
  terminalContentWidth,
} from './canvasLayout.js';

export function drawTerminal(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  _contentWidth = terminalContentWidth
) {
  const terminal = state.monitors.center.terminal;
  const contentHeight = 540;
  const lineHeight = 22;
  surface.ctx.font = monoFont(18);
  const cellWidth = surface.ctx.measureText('M').width;
  const visualLines = layoutTerminalLines(surface, terminal.lines);
  const cursorVisualLine = findTerminalCursorVisualLine(
    visualLines,
    terminal.cursor.y,
    terminal.cursor.x
  );
  const effectiveCursorLine =
    cursorVisualLine >= 0
      ? cursorVisualLine
      : Math.max(0, visualLines.length - 1);
  const maxLines = Math.floor(contentHeight / lineHeight);
  const startLine =
    visualLines.length <= maxLines
      ? 0
      : Math.min(
          Math.max(0, effectiveCursorLine - maxLines + 1),
          visualLines.length - maxLines
        );
  const visibleLines = visualLines.slice(startLine, startLine + maxLines);
  const textBlockHeight = visibleLines.length * lineHeight;
  const baseY = Math.max(20, contentHeight - textBlockHeight);

  surface.ctx.fillStyle = palette.textTerminal;
  visibleLines.forEach((line, index) => {
    const y = baseY + index * lineHeight;
    let x = 0;
    for (const span of line.spans) {
      surface.ctx.fillStyle = span.color ?? palette.textTerminal;
      surface.ctx.font = monoFont(
        18,
        span.bold ? 'bold' : span.dim ? 'lighter' : 'normal'
      );
      surface.ctx.fillText(span.text, x, y);
      x += surface.ctx.measureText(span.text).width;
    }
  });

  const cursorLine = effectiveCursorLine - startLine;
  if (
    terminal.cursor.visible &&
    cursorLine >= 0 &&
    cursorLine < visibleLines.length
  ) {
    const line = visibleLines[cursorLine];
    if (!line) return;
    surface.ctx.font = monoFont(18);
    const cursorX =
      Math.max(0, terminal.cursor.x - line.startColumn) * cellWidth;
    surface.ctx.fillStyle = palette.textTerminal;
    surface.ctx.fillRect(
      cursorX,
      baseY + cursorLine * lineHeight - 16,
      Math.max(2, cellWidth * 0.6),
      20
    );
  }
}

export function drawEditorPanel(
  surface: CanvasRenderSurface,
  editor: GameRenderState['monitors']['center']['editor'],
  contentWidth = terminalContentWidth
) {
  const headerHeight = 54;
  surface.ctx.fillStyle = palette.bgCardDark;
  roundRect(surface.ctx, 0, 0, contentWidth, headerHeight, 6);
  surface.ctx.fill();

  surface.ctx.fillStyle = palette.textMuted;
  surface.ctx.font = monoFont(13);
  surface.ctx.fillText('FILES', 12, 18);
  surface.ctx.fillStyle = editor.dirty
    ? palette.textWarningFg
    : editor.status === 'error'
      ? palette.statusCritical
      : palette.textTerminalMuted;
  surface.ctx.font = uiFont(15, 'bold');
  const status =
    editor.status === 'saving'
      ? 'SAVING'
      : editor.dirty
        ? 'UNSAVED'
        : editor.status === 'error'
          ? 'ERROR'
          : 'SAVED';
  surface.ctx.fillText(status, contentWidth - 90, 18);

  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = monoFont(16, 'bold');
  const currentPath =
    editor.currentPath ?? editor.files[0]?.path ?? '/workspace';
  surface.ctx.fillText(shortenPath(currentPath, 54), 12, 42);

  const fileListTop = headerHeight + 12;
  const fileListWidth = 142;
  surface.ctx.fillStyle = palette.bgPanelDark;
  roundRect(surface.ctx, 0, fileListTop, fileListWidth, 470, 6);
  surface.ctx.fill();
  surface.ctx.font = monoFont(13);
  let fileY = fileListTop + 24;
  for (const file of editor.files.slice(0, 14)) {
    const active = file.path === editor.currentPath;
    if (active) {
      surface.ctx.fillStyle = palette.bgButtonSecondary;
      roundRect(surface.ctx, 6, fileY - 16, fileListWidth - 12, 24, 4);
      surface.ctx.fill();
      surface.ctx.strokeStyle = palette.borderDefault;
      surface.ctx.lineWidth = 1;
      surface.ctx.stroke();
    }
    surface.ctx.fillStyle = active
      ? palette.textPrimary
      : palette.textSecondary;
    surface.ctx.fillText(
      shortenPath(file.path.replace('/workspace/', ''), 18),
      12,
      fileY
    );
    fileY += 28;
  }

  const editorX = fileListWidth + 14;
  const editorY = fileListTop;
  const editorWidth = contentWidth - editorX;
  const editorHeight = 470;
  surface.ctx.fillStyle = palette.bgTerminal;
  roundRect(surface.ctx, editorX, editorY, editorWidth, editorHeight, 6);
  surface.ctx.fill();
  surface.ctx.strokeStyle =
    editor.status === 'error' ? palette.statusCritical : palette.borderDefault;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  if (editor.status === 'loading') {
    surface.ctx.fillStyle = palette.textMuted;
    surface.ctx.font = uiFont(17);
    surface.ctx.fillText('読み込み中...', editorX + 16, editorY + 34);
    return;
  }
  if (editor.status === 'error' && editor.error) {
    surface.ctx.fillStyle = palette.statusCritical;
    surface.ctx.font = uiFont(16, 'bold');
    wrapText(
      surface.ctx,
      editor.error,
      editorX + 16,
      editorY + 34,
      editorWidth - 32,
      22,
      4
    );
  }

  surface.ctx.font = monoFont(15);
  const lineHeight = 21;
  const lines = editor.content.split('\n');
  const maxLines = Math.floor((editorHeight - 24) / lineHeight);
  const cursorLine = Math.max(1, editor.cursor.line);
  const start = Math.max(
    0,
    Math.min(Math.max(0, lines.length - maxLines), cursorLine - maxLines)
  );
  for (
    let index = 0;
    index < Math.min(maxLines, lines.length - start);
    index += 1
  ) {
    const lineNumber = start + index + 1;
    const y = editorY + 24 + index * lineHeight;
    surface.ctx.fillStyle = palette.textMuted;
    surface.ctx.fillText(String(lineNumber).padStart(3, ' '), editorX + 10, y);
    surface.ctx.fillStyle = palette.textTerminal;
    surface.ctx.fillText(
      (lines[start + index] ?? '').slice(0, 42),
      editorX + 52,
      y
    );
  }
}

export function drawCenterToolTabs(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const monitor = monitorLayout('terminal');
  const tabs = centerToolTabRegions();
  for (const tab of tabs) {
    const active = state.monitors.center.activeTool === tab.id;
    surface.ctx.fillStyle = active
      ? palette.bgButtonPrimary
      : palette.bgTerminal;
    roundRect(surface.ctx, tab.x, tab.y, tab.width, tab.height, 4);
    surface.ctx.fill();
    surface.ctx.strokeStyle = active
      ? palette.borderFocus
      : palette.borderMuted;
    surface.ctx.lineWidth = 2;
    surface.ctx.stroke();
    surface.ctx.fillStyle = active ? palette.textOnPrimary : palette.textLink;
    surface.ctx.font = monoFont(15);
    centeredText(
      surface.ctx,
      tab.label,
      tab.x,
      tab.y - 6,
      tab.width,
      tab.height
    );
  }
  const editor = state.monitors.center.editor;
  if (editor.dirty) {
    const editorTab = tabs.find((item) => item.id === 'editor');
    if (editorTab) {
      surface.ctx.fillStyle = palette.statusCritical;
      surface.ctx.beginPath();
      surface.ctx.arc(
        editorTab.x + editorTab.width - 10,
        editorTab.y + 9,
        5,
        0,
        Math.PI * 2
      );
      surface.ctx.fill();
    }
  }

  const workspaceLabel = '/workspace';
  surface.ctx.font = monoFont(15);
  const workspaceWidth = surface.ctx.measureText(workspaceLabel).width;
  surface.ctx.fillStyle = palette.textMuted;
  surface.ctx.fillText(
    workspaceLabel,
    monitor.x + monitor.width - PANEL_HEADER_TEXT_RIGHT_MARGIN - workspaceWidth,
    monitor.y + 22
  );
}

export function layoutTerminalLines(
  surface: CanvasRenderSurface,
  lines: string[]
): TerminalVisualLine[] {
  const visualLines: TerminalVisualLine[] = [];
  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
    const cached = getCachedTerminalLine(surface, lines[sourceIndex] ?? '');
    visualLines.push(
      mirrorTerminalVisualLine(cached.spans, cached.plain, sourceIndex)
    );
  }
  return visualLines.length > 0 ? visualLines : [emptyTerminalVisualLine(0)];
}

export function getCachedTerminalLine(
  surface: CanvasRenderSurface,
  line: string
) {
  const source = line.slice(0, 120);
  const cached = surface.terminalLineCache.get(source);
  if (cached) return cached;
  const parsed = {
    spans: parseAnsiLine(source),
    plain: stripAnsi(source),
  };
  surface.terminalLineCache.set(source, parsed);
  if (surface.terminalLineCache.size > 500) {
    const oldest = surface.terminalLineCache.keys().next().value;
    if (oldest !== undefined) surface.terminalLineCache.delete(oldest);
  }
  return parsed;
}

export function drawCenterPanel(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  contentWidth = terminalContentWidth
) {
  if (state.monitors.center.activeTool === 'editor') {
    drawEditorPanel(surface, state.monitors.center.editor, contentWidth);
    return;
  }
  drawTerminal(surface, state, contentWidth);
}
