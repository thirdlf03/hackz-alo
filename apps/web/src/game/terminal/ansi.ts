export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Keep in sync with gamePalette.ts */
const ANSI_COLORS: Record<number, string> = {
  30: '#9aa8b8',
  31: '#f87171',
  32: '#4ade80',
  33: '#fbbf24',
  34: '#9ecbff',
  35: '#c4b5fd',
  36: '#5ec8ff',
  37: '#f0f4f8',
  90: '#c5d0dc',
  91: '#f87171',
  92: '#a8f5c4',
  93: '#ffe08a',
  94: '#9ecbff',
  95: '#c4b5fd',
  96: '#5ec8ff',
  97: '#f0f4f8',
};

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
  return line.replace(/\u001b\[[0-9;]*m/g, '');
}
