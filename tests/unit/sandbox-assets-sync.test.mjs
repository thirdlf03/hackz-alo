import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

const codegen = await tsImport(
  '../../scripts/lib/sandbox-assets-codegen.mjs',
  import.meta.url
);

test('sandbox asset sources exist and codegen matches assets.ts', () => {
  const assets = codegen.readSandboxAssets(repoRoot);
  assert.equal(assets.length, codegen.SANDBOX_ASSET_FILES.length);

  const expected = codegen.readFormattedSandboxAssetsTs(repoRoot);
  const actual = codegen.normalizeGeneratedSource(
    readFileSync(codegen.assetsTsPath(repoRoot), 'utf8')
  );
  assert.equal(actual, expected);
});
