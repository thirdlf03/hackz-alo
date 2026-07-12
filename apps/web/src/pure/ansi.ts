export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Keep in sync with gamePalette.ts */
const ANSI_COLORS: Record<number, string> = {
  30: '#5e7a66',
  31: '#ff6b6b',
  32: '#7cfc9a',
  33: '#ffcf5c',
  34: '#8aa892',
  35: '#d8f3dc',
  36: '#b7f2c3',
  37: '#d8f3dc',
  90: '#8aa892',
  91: '#ff9a9a',
  92: '#dcffe4',
  93: '#ffcf5c',
  94: '#8aa892',
  95: '#d8f3dc',
  96: '#b7f2c3',
  97: '#dcffe4',
};

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;]*m`, 'g');

export function parseAnsiLine(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let current = '';
  let color: string | undefined;
  let bold = false;
  let dim = false;

  const flush = () => {
    if (!current) return;
    spans.push({
      text: current,
      ...(color ? {color} : {}),
      ...(bold ? {bold: true} : {}),
      ...(dim ? {dim: true} : {}),
    });
    current = '';
  };

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\u001b' && line[index + 1] === '[') {
      flush();
      const end = line.indexOf('m', index);
      if (end === -1) {
        current += line.slice(index);
        break;
      }
      const code = line.slice(index + 2, end);
      if (code === '0') {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === '1') {
        bold = true;
      } else if (code === '2') {
        dim = true;
      } else if (ANSI_COLORS[Number(code)]) {
        color = ANSI_COLORS[Number(code)];
      }
      index = end;
      continue;
    }
    current += line[index] ?? '';
  }
  flush();
  return spans.length > 0 ? spans : [{text: line}];
}

export function stripAnsi(line: string) {
  return line.replace(ANSI_ESCAPE_PATTERN, '');
}
