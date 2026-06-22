import type {AnsiSpan} from './ansi.js';

export interface TerminalVisualLine {
  sourceIndex: number;
  startColumn: number;
  endColumn: number;
  plain: string;
  spans: AnsiSpan[];
}

export function mirrorTerminalVisualLine(
  spans: AnsiSpan[],
  plain: string,
  sourceIndex: number
): TerminalVisualLine {
  return {
    sourceIndex,
    startColumn: 0,
    endColumn: plain.length,
    plain,
    spans,
  };
}

export function findTerminalCursorVisualLine(
  lines: TerminalVisualLine[],
  sourceIndex: number,
  cursorColumn: number
) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || line.sourceIndex !== sourceIndex) continue;
    if (cursorColumn >= line.startColumn && cursorColumn <= line.endColumn) {
      return index;
    }
  }
  return -1;
}

export function emptyTerminalVisualLine(
  sourceIndex: number
): TerminalVisualLine {
  return {
    sourceIndex,
    startColumn: 0,
    endColumn: 0,
    plain: '',
    spans: [{text: ''}],
  };
}
