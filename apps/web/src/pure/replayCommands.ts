import type {ReplayEventType} from '@incident/shared';

export function classifyCommandEvent(
  command: string
):
  | ReplayEventType
  | 'recovery_check'
  | 'service_restart'
  | 'file_opened'
  | null {
  const normalized = command.trim();
  if (/^unctl\s+restart\b/i.test(normalized)) return 'service_restart';
  if (/^curl\b/i.test(normalized) || /^unctl\s+status\b/i.test(normalized)) {
    return 'recovery_check';
  }
  const fileMatch = normalized.match(
    /^(cat|less|more|head|tail|vim|nano|vi)\s+(\S+)/i
  );
  if (fileMatch) return 'file_opened';
  return null;
}

export function commandEventPayload(
  command: string,
  type: ReturnType<typeof classifyCommandEvent>
) {
  if (type === 'file_opened') {
    const match = command
      .trim()
      .match(/^(cat|less|more|head|tail|vim|nano|vi)\s+(\S+)/i);
    return {command, path: match?.[2] ?? ''};
  }
  if (type === 'recovery_check' || type === 'service_restart') return {command};
  return {command};
}
