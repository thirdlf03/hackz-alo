import type {ReplayEventType} from '@incident/shared';

const fileViewCommands = new Set([
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'vim',
  'nano',
  'vi',
]);

const optionsWithSeparateValue: Readonly<Record<string, ReadonlySet<string>>> =
  {
    head: new Set(['-n', '--lines', '-c', '--bytes']),
    tail: new Set(['-n', '--lines', '-c', '--bytes']),
    less: new Set([
      '-p',
      '--pattern',
      '-P',
      '--prompt',
      '-t',
      '--tag',
      '-T',
      '--tag-file',
      '-x',
      '--tabs',
    ]),
    more: new Set(['-n', '--lines', '-t', '--tag']),
    nano: new Set(['-T', '--tabsize']),
    vim: new Set([
      '-c',
      '--cmd',
      '-S',
      '-u',
      '-U',
      '-i',
      '-T',
      '-t',
      '--servername',
    ]),
    vi: new Set([
      '-c',
      '--cmd',
      '-S',
      '-u',
      '-U',
      '-i',
      '-T',
      '-t',
      '--servername',
    ]),
  };

export function classifyCommandEvent(
  command: string
):
  | ReplayEventType
  | 'recovery_check'
  | 'service_restart'
  | 'file_opened'
  | null {
  const normalized = command.trim();
  if (/^yamactl\s+restart\b/i.test(normalized)) return 'service_restart';
  if (/^curl\b/i.test(normalized) || /^yamactl\s+status\b/i.test(normalized)) {
    return 'recovery_check';
  }
  if (filePathFromCommand(normalized) !== null) return 'file_opened';
  return null;
}

export function commandEventPayload(
  command: string,
  type: ReturnType<typeof classifyCommandEvent>
) {
  if (type === 'file_opened') {
    return {command, path: filePathFromCommand(command) ?? ''};
  }
  if (type === 'recovery_check' || type === 'service_restart') return {command};
  return {command};
}

/** Find the first file operand while handling common viewer/editor options. */
export function filePathFromCommand(command: string) {
  const tokens = command.trim().split(/\s+/);
  const executable = tokens[0]?.toLowerCase();
  if (!executable || !fileViewCommands.has(executable)) return null;

  const optionsTakingValue = optionsWithSeparateValue[executable] ?? new Set();
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token === '--') return tokens[index + 1] ?? null;
    if (token.startsWith('-') || token.startsWith('+')) {
      if (optionsTakingValue.has(token) && !token.includes('=')) index += 1;
      continue;
    }
    return token;
  }
  return null;
}
