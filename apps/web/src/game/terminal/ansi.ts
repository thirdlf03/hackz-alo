export type AnsiSpan = {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
};

const ANSI_COLORS: Record<number, string> = {
  30: "#94a3b8",
  31: "#f87171",
  32: "#4ade80",
  33: "#facc15",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#22d3ee",
  37: "#e2e8f0",
  90: "#64748b",
  91: "#fca5a5",
  92: "#86efac",
  93: "#fde047",
  94: "#93c5fd",
  95: "#d8b4fe",
  96: "#67e8f9",
  97: "#f8fafc"
};

export function parseAnsiLine(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let current = "";
  let color: string | undefined;
  let bold = false;
  let dim = false;

  const flush = () => {
    if (!current) return;
    spans.push({
      text: current,
      ...(color ? { color } : {}),
      ...(bold ? { bold: true } : {}),
      ...(dim ? { dim: true } : {})
    });
    current = "";
  };

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\u001b" && line[index + 1] === "[") {
      flush();
      const end = line.indexOf("m", index);
      if (end === -1) {
        current += line.slice(index);
        break;
      }
      const code = line.slice(index + 2, end);
      if (code === "0") {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === "1") {
        bold = true;
      } else if (code === "2") {
        dim = true;
      } else if (ANSI_COLORS[Number(code)]) {
        color = ANSI_COLORS[Number(code)];
      }
      index = end;
      continue;
    }
    current += line[index] ?? "";
  }
  flush();
  return spans.length > 0 ? spans : [{ text: line }];
}

export function stripAnsi(line: string) {
  return line.replace(/\u001b\[[0-9;]*m/g, "");
}
