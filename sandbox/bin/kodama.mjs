#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function runKodama(source) {
  const env = new Map();
  const lines = source.split(/\r?\n/);
  let lastValue = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith('やまびこ帳')) continue;

    if (raw.startsWith('かえす')) {
      const expr = raw.slice('かえす'.length).trim();
      return expr ? evaluate(expr, env, index + 1) : lastValue;
    }

    if (raw.startsWith('よぶ ')) {
      const match = raw.match(/^よぶ\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/u);
      if (!match) throw runtimeError('SYNTAX_ERROR', index + 1);
      const value = evaluate(match[2], env, index + 1);
      env.set(match[1], value);
      lastValue = value;
      continue;
    }

    if (raw.startsWith('はかる ')) {
      lastValue = evaluate(raw.slice('はかる '.length), env, index + 1);
      continue;
    }

    throw runtimeError('SYNTAX_ERROR', index + 1);
  }

  return lastValue;
}

function evaluate(expression, env, line) {
  const tokens = tokenize(expression);
  let index = 0;

  function parseExpression() {
    let value = parseTerm();
    while (tokens[index] === 'たす' || tokens[index] === 'ひく') {
      const op = tokens[index++];
      const right = parseTerm();
      value = op === 'たす' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    while (tokens[index] === 'かける' || tokens[index] === 'わる') {
      const op = tokens[index++];
      const right = parseFactor();
      if (op === 'わる' && right === 0)
        {throw runtimeError('DIVISION_BY_ZERO', line);}
      value = op === 'かける' ? value * right : value / right;
    }
    return value;
  }

  function parseFactor() {
    const token = tokens[index++];
    if (token === undefined) throw runtimeError('SYNTAX_ERROR', line);
    if (token === '(') {
      const value = parseExpression();
      if (tokens[index++] !== ')') throw runtimeError('SYNTAX_ERROR', line);
      return value;
    }
    if (token === 'しずか') return 0;
    if (token === 'こだま') return 1;
    if (/^-?\d+(\.\d+)?$/u.test(token)) return Number(token);
    if (env.has(token)) return env.get(token);
    throw runtimeError('UNDEFINED_VARIABLE', line);
  }

  const value = parseExpression();
  if (index !== tokens.length) throw runtimeError('SYNTAX_ERROR', line);
  return value;
}

function tokenize(expression) {
  const tokens = [];
  let current = '';
  for (const char of expression) {
    if (/\s/u.test(char)) {
      pushCurrent();
    } else if (char === '(' || char === ')') {
      pushCurrent();
      tokens.push(char);
    } else {
      current += char;
    }
  }
  pushCurrent();
  return tokens;

  function pushCurrent() {
    if (current) {
      tokens.push(current);
      current = '';
    }
  }
}

function runtimeError(code, line) {
  const error = new Error('こだまが返ってきません');
  error.code = code;
  error.line = line;
  error.column = 1;
  return error;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [command, file] = process.argv.slice(2);
  if ((command !== 'run' && command !== 'check') || !file) {
    console.error('usage: kodama <run|check> <file>');
    process.exit(1);
  }

  try {
    const source = await readFile(file, 'utf8');
    const result = runKodama(source);
    if (command === 'run') console.log(result);
    else console.log('ok');
  } catch (error) {
    console.error('こだまが返ってきません');
    process.exit(1);
  }
}
