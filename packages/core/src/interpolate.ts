import type { Issue } from './errors';
import { isPlainObject, keyPath } from './util';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Interpolates a string with the Compose syntax: $VAR, ${VAR}, ${VAR:-default},
 * ${VAR-default}, ${VAR:?error}, ${VAR?error}, ${VAR:+value}, ${VAR+value}
 * (defaults may nest), and $$ for a literal "$".
 *
 * Only the given variables exist. Spawner never interpolates a compose file
 * with its own process environment, which holds its secrets: a reference to an
 * unknown variable without a default is an error, not an empty string.
 */
export function interpolateString(input: string, vars: Record<string, string>, path: string, issues: Issue[]): string {
  let output = '';
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char !== '$') {
      output += char;
      index++;
      continue;
    }
    const next = input[index + 1];
    if (next === '$') {
      output += '$';
      index += 2;
      continue;
    }
    if (next === '{') {
      const end = closingBrace(input, index + 2);
      if (end === -1) {
        issues.push({
          code: 'interpolation.invalid',
          path,
          message: `unclosed "\${" in ${JSON.stringify(input)}`,
          hint: 'write $$ for a literal $',
        });
        return output + input.slice(index);
      }
      output += resolveBraced(input.slice(index + 2, end), vars, path, issues);
      index = end + 1;
      continue;
    }
    const name = NAME.exec(input.slice(index + 1));
    if (name) {
      output += lookup(name[0], vars, path, issues);
      index += 1 + name[0].length;
      continue;
    }
    issues.push({
      code: 'interpolation.invalid',
      path,
      message: `invalid "$" in ${JSON.stringify(input)}`,
      hint: 'write $$ for a literal $',
    });
    output += '$';
    index++;
  }
  return output;
}

/**
 * Returns a deep copy of a parsed YAML tree with every string value
 * interpolated. Keys are left untouched, and extension fields ("x-*") are
 * skipped since they are dropped from the rendered file.
 */
export function interpolateTree(value: unknown, vars: Record<string, string>, path: string, issues: Issue[]): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, vars, path, issues);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => interpolateTree(item, vars, keyPath(path, index), issues));
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = key.startsWith('x-') ? item : interpolateTree(item, vars, keyPath(path, key), issues);
    }
    return copy;
  }
  return value;
}

function closingBrace(input: string, start: number): number {
  let depth = 1;
  for (let index = start; index < input.length; index++) {
    if (input[index] === '$' && input[index + 1] === '$') {
      index++;
    } else if (input[index] === '$' && input[index + 1] === '{') {
      depth++;
      index++;
    } else if (input[index] === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function resolveBraced(body: string, vars: Record<string, string>, path: string, issues: Issue[]): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?|:\+|\+)([\s\S]*))?$/.exec(body);
  if (!match) {
    issues.push({ code: 'interpolation.invalid', path, message: `invalid expression "\${${body}}"` });
    return '';
  }
  const [, name, operator, rest = ''] = match;
  const isSet = Object.prototype.hasOwnProperty.call(vars, name);
  const value = isSet ? vars[name] : '';
  const isNonEmpty = isSet && value !== '';

  switch (operator) {
    case undefined:
      return lookup(name, vars, path, issues);
    case ':-':
      return isNonEmpty ? value : interpolateString(rest, vars, path, issues);
    case '-':
      return isSet ? value : interpolateString(rest, vars, path, issues);
    case ':?':
    case '?':
      if (operator === ':?' ? isNonEmpty : isSet) {
        return value;
      }
      issues.push({
        code: 'interpolation.required_variable',
        path,
        message: `${name}: ${interpolateString(rest, vars, path, issues) || 'required variable is missing'}`,
      });
      return '';
    case ':+':
      return isNonEmpty ? interpolateString(rest, vars, path, issues) : '';
    default:
      return isSet ? interpolateString(rest, vars, path, issues) : '';
  }
}

function lookup(name: string, vars: Record<string, string>, path: string, issues: Issue[]): string {
  if (Object.prototype.hasOwnProperty.call(vars, name)) {
    return vars[name];
  }
  issues.push({
    code: 'interpolation.unknown_variable',
    path,
    message: `unknown variable ${name}`,
    hint: 'only SPAWNER_* and project variables exist; write ${' + name + ':-value} for an optional one',
  });
  return '';
}
