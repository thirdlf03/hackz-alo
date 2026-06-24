export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export function parseTerminalResize(body: {
  cols?: number;
  rows?: number;
}): TerminalDimensions {
  return {
    cols:
      typeof body.cols === 'number' && body.cols >= 40 && body.cols <= 200
        ? body.cols
        : 80,
    rows:
      typeof body.rows === 'number' && body.rows >= 10 && body.rows <= 60
        ? body.rows
        : 24,
  };
}

export function mergeTerminalResize(
  current: TerminalDimensions,
  body: {cols?: number; rows?: number}
): TerminalDimensions {
  const parsed = parseTerminalResize(body);
  return {
    cols:
      typeof body.cols === 'number' && body.cols >= 40 && body.cols <= 200
        ? parsed.cols
        : current.cols,
    rows:
      typeof body.rows === 'number' && body.rows >= 10 && body.rows <= 60
        ? parsed.rows
        : current.rows,
  };
}
