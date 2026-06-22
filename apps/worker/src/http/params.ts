export function parseSequence(value: string | undefined) {
  const raw = value ?? '0';
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 && number <= 999999
    ? number
    : undefined;
}

export function parsePartNumber(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10000
    ? number
    : undefined;
}

export function parseOptionalNumber(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeOptionalMs(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}
