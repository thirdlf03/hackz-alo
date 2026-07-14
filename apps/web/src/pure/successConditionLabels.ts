import type {SuccessCondition} from '@incident/shared';

/**
 * Short Japanese description of a scenario success condition, used by the
 * recovery-check result UI (canvasRenderChrome.ts drawInputDock) to show
 * players which conditions are unmet without exposing the raw condition
 * shape.
 */
export function describeSuccessCondition(condition: SuccessCondition): string {
  switch (condition.type) {
    case 'http_status':
      return `${httpStatusTarget(condition.url)} が ${String(condition.status)}`;
    case 'disk_usage_below':
      return `${condition.path} のディスク使用率 ${String(condition.valuePercent)}% 未満`;
    case 'process_running':
      return `${condition.processId} プロセス稼働`;
    case 'process_absent':
      return `${condition.processId} プロセス停止済み`;
    case 'log_absent':
      return `${condition.path} に「${condition.pattern}」が含まれない`;
    case 'kodama_batch_ok':
      return `${condition.jobId} バッチが正常終了`;
    default: {
      const exhaustiveCheck: never = condition;
      return exhaustiveCheck;
    }
  }
}

/** Extracts the trailing path segment (e.g. "health") from a health-check
 * URL for a compact label; falls back to the full URL when parsing fails. */
function httpStatusTarget(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? url;
  } catch {
    const segments = url.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? url;
  }
}
