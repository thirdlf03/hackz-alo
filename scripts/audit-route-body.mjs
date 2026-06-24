#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  path.join(root, 'apps/worker/src/index.ts'),
  path.join(root, 'apps/worker/src/routes/adminRoutes.ts'),
  path.join(root, 'apps/worker/src/routes/healthRoutes.ts'),
  path.join(root, 'apps/worker/src/routes/replayRoutes.ts'),
  path.join(root, 'apps/worker/src/routes/scenarioRoutes.ts'),
  path.join(root, 'apps/worker/src/routes/sessionRoutes.ts'),
];

const forbiddenPatterns = [
  {
    label: 'request.json()',
    pattern: /\brequest\.json\s*\(/,
  },
  {
    label: '.json().catch',
    pattern: /\.json\s*\(\s*\)\s*\.catch/,
  },
];

const violations = [];
for (const file of targets) {
  const source = await readFile(file, 'utf8');
  const relativePath = path.relative(root, file);
  for (const {label, pattern} of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push({file: relativePath, pattern: label});
    }
  }
}

if (violations.length > 0) {
  console.error('audit-route-body: forbidden ad hoc body parsing found');
  for (const violation of violations) {
    console.error(`  ${violation.file}: ${violation.pattern}`);
  }
  process.exit(1);
}

console.log(
  `audit-route-body: ok (${String(targets.length)} route entrypoints checked)`
);
