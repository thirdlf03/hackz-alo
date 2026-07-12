import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const DEFAULT_API_CONFIG = {
  service: 'yamabiko-api',
  version: 'v41',
  dbHost: '127.0.0.1',
  dbPort: 15432,
  logQuotaBytes: 512 * 1024 * 1024,
};

export function apiConfigPath(workspace = DEFAULT_WORKSPACE) {
  return path.join(workspace, 'etc', 'yamabiko-api.json');
}

export function previousReleasePath(workspace = DEFAULT_WORKSPACE) {
  return path.join(workspace, 'releases', 'yamabiko-api.previous.json');
}

export async function readApiConfig(workspace = DEFAULT_WORKSPACE) {
  const configPath = apiConfigPath(workspace);
  if (!existsSync(configPath)) {
    return {ok: true, config: {...DEFAULT_API_CONFIG}};
  }
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return {ok: true, config: {...DEFAULT_API_CONFIG, ...parsed}};
  } catch {
    return {ok: false, error: `${configPath} is not valid JSON`};
  }
}

export async function ensureApiConfig(workspace = DEFAULT_WORKSPACE) {
  await mkdir(path.dirname(apiConfigPath(workspace)), {recursive: true});
  await mkdir(path.dirname(previousReleasePath(workspace)), {recursive: true});
  if (!existsSync(apiConfigPath(workspace))) {
    await writeFile(
      apiConfigPath(workspace),
      `${JSON.stringify(DEFAULT_API_CONFIG, null, 2)}\n`
    );
  }
  if (!existsSync(previousReleasePath(workspace))) {
    await writeFile(
      previousReleasePath(workspace),
      `${JSON.stringify({...DEFAULT_API_CONFIG, version: 'v40'}, null, 2)}\n`
    );
  }
}
