#!/usr/bin/env node
// commit-msg フック: Conventional Commits 形式をチェックする。
// 使い方: node scripts/check-commit-msg.mjs <commit-msg-file>
import {readFile} from 'node:fs/promises';

const TYPES = [
  'feat',
  'fix',
  'docs',
  'test',
  'refactor',
  'perf',
  'chore',
  'ci',
  'build',
  'style',
  'revert',
];

const SUBJECT_PATTERN = new RegExp(
  `^(${TYPES.join('|')})(\\([\\w./-]+\\))?!?: .+`
);

// git が自動生成するメッセージはそのまま通す。
const AUTO_GENERATED = /^(Merge |Revert "|fixup!|squash!|amend!)/;

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-commit-msg.mjs <commit-msg-file>');
  process.exit(2);
}

const raw = await readFile(file, 'utf8');
const subject =
  raw
    .split('\n')
    .find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';

if (AUTO_GENERATED.test(subject) || SUBJECT_PATTERN.test(subject)) {
  process.exit(0);
}

console.error(`commit message subject does not follow Conventional Commits:

  ${subject}

expected: <type>(<scope>)?: <subject>
types:    ${TYPES.join(' | ')}
examples: feat: 切り分けシナリオを追加
          fix(worker): read token の期限判定を修正

see CONTRIBUTING.md for details. (skip once: LEFTHOOK=0 git commit)`);
process.exit(1);
