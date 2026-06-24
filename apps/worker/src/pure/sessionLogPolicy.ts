const ALLOWED_SESSION_LOG_FILES = new Set(['access', 'app', 'batch']);

export function isAllowedSessionLogFile(file: string) {
  return ALLOWED_SESSION_LOG_FILES.has(file);
}

export function clampSessionLogTail(tail: number) {
  return Math.max(1, Math.min(200, Number.isFinite(tail) ? tail : 50));
}
