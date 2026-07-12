export function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function shellPathSegment(value: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error('invalid process id');
  }
  return value;
}

export function normalizeWorkspaceMarkerPath(value: string) {
  if (!isWorkspacePath(value)) {
    throw new Error('marker path must stay inside /workspace');
  }
  return value;
}

export function normalizeEditableWorkspacePath(value: string) {
  if (!isWorkspacePath(value)) {
    throw new Error('path must stay inside /workspace');
  }
  if (
    !value.startsWith('/workspace/services/') &&
    !value.startsWith('/workspace/run/') &&
    !value.startsWith('/workspace/etc/') &&
    !value.startsWith('/workspace/releases/')
  ) {
    throw new Error(
      'editable files must be under /workspace/services, /workspace/run, /workspace/etc, or /workspace/releases'
    );
  }
  if (value.includes('\0') || value.split('/').includes('..')) {
    throw new Error('invalid file path');
  }
  return value;
}

export function isWorkspacePath(value: string) {
  return (
    value.startsWith('/workspace/') &&
    !value.includes('\0') &&
    !value.split('/').includes('..')
  );
}
