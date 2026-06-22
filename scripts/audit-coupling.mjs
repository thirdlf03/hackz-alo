#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

const sourceRoots = ['apps', 'packages'].map((item) => path.join(root, item));
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const ignoredDirs = new Set([
  '.git',
  '.vite',
  '.wrangler',
  'dist',
  'node_modules',
]);

const packageEntrypoints = new Map([
  ['@incident/scenarios', 'packages/scenarios/src/index.ts'],
  ['@incident/shared', 'packages/shared/src/index.ts'],
  ['@incident/web', 'apps/web/src/main.tsx'],
  ['@incident/worker', 'apps/worker/src/index.ts'],
]);

const thresholds = new Map([
  ['apps/web/src/app/App.tsx', {loc: 1100}],
  ['apps/worker/src/durable/SessionDurableObject.ts', {loc: 750}],
  ['apps/worker/src/index.ts', {loc: 260}],
  ['apps/worker/src/sandbox/runtime.ts', {loc: 420}],
]);

const files = (await collectSourceFiles(sourceRoots)).sort();
const fileSet = new Set(files);
const stats = new Map();
const fanIn = new Map(files.map((file) => [file, new Set()]));
const unresolvedInternalImports = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const internalImports = new Set();
  for (const specifier of extractImportSpecifiers(source)) {
    const resolved = resolveInternalImport(file, specifier, fileSet);
    if (!resolved.internal) continue;
    if (resolved.file) {
      internalImports.add(resolved.file);
      fanIn.get(resolved.file)?.add(file);
    } else {
      unresolvedInternalImports.push({file, specifier});
    }
  }
  stats.set(file, {
    loc: countLines(source),
    fanOut: internalImports.size,
  });
}

const rows = [...thresholds.entries()].map(([relativePath, threshold]) => {
  const file = path.join(root, relativePath);
  const fileStats = stats.get(file) ?? {loc: 0, fanOut: 0};
  const inbound = fanIn.get(file)?.size ?? 0;
  const overLoc =
    typeof threshold.loc === 'number' && fileStats.loc > threshold.loc;
  return {
    relativePath,
    loc: fileStats.loc,
    locTarget: threshold.loc,
    fanOut: fileStats.fanOut,
    fanIn: inbound,
    status: overLoc ? 'over' : 'ok',
  };
});

console.log('Coupling audit');
console.log(`Source files: ${files.length}`);
console.log('');
printTable(
  ['file', 'loc', 'target', 'fan-out', 'fan-in', 'status'],
  rows.map((row) => [
    row.relativePath,
    String(row.loc),
    `<= ${row.locTarget}`,
    String(row.fanOut),
    String(row.fanIn),
    row.status,
  ])
);

const topFanOut = [...stats.entries()]
  .map(([file, fileStats]) => ({
    file: relative(file),
    fanOut: fileStats.fanOut,
  }))
  .filter((item) => item.fanOut > 0)
  .sort((a, b) => b.fanOut - a.fanOut || a.file.localeCompare(b.file))
  .slice(0, 10);

const topFanIn = [...fanIn.entries()]
  .map(([file, importers]) => ({
    file: relative(file),
    fanIn: importers.size,
  }))
  .filter((item) => item.fanIn > 0)
  .sort((a, b) => b.fanIn - a.fanIn || a.file.localeCompare(b.file))
  .slice(0, 10);

console.log('');
console.log('Top internal fan-out');
printTable(
  ['file', 'fan-out'],
  topFanOut.map((item) => [item.file, String(item.fanOut)])
);

console.log('');
console.log('Top internal fan-in');
printTable(
  ['file', 'fan-in'],
  topFanIn.map((item) => [item.file, String(item.fanIn)])
);

if (unresolvedInternalImports.length > 0) {
  console.log('');
  console.log('Unresolved internal imports');
  printTable(
    ['file', 'specifier'],
    unresolvedInternalImports
      .slice(0, 20)
      .map((item) => [relative(item.file), item.specifier])
  );
  if (unresolvedInternalImports.length > 20) {
    console.log(`... ${unresolvedInternalImports.length - 20} more`);
  }
}

const overThreshold = rows.filter((row) => row.status !== 'ok');
if (overThreshold.length > 0) {
  console.log('');
  console.log(
    `Thresholds over target: ${overThreshold
      .map((row) => row.relativePath)
      .join(', ')}`
  );
}

if (strict && overThreshold.length > 0) {
  process.exitCode = 1;
}

async function collectSourceFiles(roots) {
  const collected = [];
  for (const dir of roots) {
    await collect(dir, collected);
  }
  return collected;
}

async function collect(dir, collected) {
  const entries = await readdir(dir, {withFileTypes: true}).catch(() => []);
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(fullPath, collected);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      collected.push(fullPath);
    }
  }
}

function extractImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function resolveInternalImport(fromFile, specifier, fileSet) {
  if (specifier.startsWith('.')) {
    return {
      internal: true,
      file: resolveSourcePath(path.resolve(path.dirname(fromFile), specifier), fileSet),
    };
  }

  const packageEntry = packageEntrypoints.get(specifier);
  if (packageEntry) {
    return {
      internal: true,
      file: path.join(root, packageEntry),
    };
  }

  for (const [packageName, entrypoint] of packageEntrypoints) {
    const prefix = `${packageName}/`;
    if (!specifier.startsWith(prefix)) continue;
    const packageRoot = path.dirname(path.join(root, entrypoint));
    return {
      internal: true,
      file: resolveSourcePath(
        path.join(packageRoot, specifier.slice(prefix.length)),
        fileSet
      ),
    };
  }

  return {internal: false, file: null};
}

function resolveSourcePath(importPath, fileSet) {
  const ext = path.extname(importPath);
  const candidates = [];

  if (ext) {
    candidates.push(importPath);
    if (ext === '.js') {
      candidates.push(
        replaceExtension(importPath, '.ts'),
        replaceExtension(importPath, '.tsx'),
        replaceExtension(importPath, '.mjs')
      );
    }
  } else {
    for (const extension of sourceExtensions) {
      candidates.push(`${importPath}${extension}`);
    }
    for (const extension of sourceExtensions) {
      candidates.push(path.join(importPath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate) || existsSync(candidate)) return candidate;
  }
  return null;
}

function replaceExtension(file, extension) {
  return `${file.slice(0, -path.extname(file).length)}${extension}`;
}

function countLines(source) {
  if (source.length === 0) return 0;
  return source.endsWith('\n')
    ? source.slice(0, -1).split(/\r?\n/).length
    : source.split(/\r?\n/).length;
}

function printTable(headers, rowsToPrint) {
  const rowsWithHeader = [headers, ...rowsToPrint];
  const widths = headers.map((_, index) =>
    Math.max(...rowsWithHeader.map((row) => row[index].length))
  );
  const formatRow = (row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  console.log(formatRow(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rowsToPrint) {
    console.log(formatRow(row));
  }
}

function relative(file) {
  return path.relative(root, file);
}
