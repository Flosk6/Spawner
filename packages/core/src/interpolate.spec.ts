import { describe, expect, it } from 'vitest';
import type { Issue } from './errors';
import { interpolateString, interpolateTree } from './interpolate';

const vars = { NAME: 'blog', EMPTY: '', URL: 'https://api.test' };

function run(input: string) {
  const issues: Issue[] = [];
  return { value: interpolateString(input, vars, 'path', issues), issues };
}

describe('interpolateString', () => {
  it.each([
    ['$NAME', 'blog'],
    ['${NAME}', 'blog'],
    ['pre-${NAME}-post', 'pre-blog-post'],
    ['$$NAME', '$NAME'],
    ['cost: $$5', 'cost: $5'],
    ['${MISSING:-default}', 'default'],
    ['${EMPTY:-default}', 'default'],
    ['${EMPTY-default}', ''],
    ['${MISSING-default}', 'default'],
    ['${NAME:+set}', 'set'],
    ['${EMPTY:+set}', ''],
    ['${EMPTY+set}', 'set'],
    ['${MISSING+set}', ''],
    ['${MISSING:-${NAME}-fallback}', 'blog-fallback'],
    ['${MISSING:-${ALSO_MISSING:-deep}}', 'deep'],
    ['no variables', 'no variables'],
  ])('%s gives %j', (input, expected) => {
    expect(run(input)).toEqual({ value: expected, issues: [] });
  });

  it('refuses unknown variables instead of leaking an empty value', () => {
    const { issues } = run('${SESSION_SECRET}');
    expect(issues).toEqual([
      expect.objectContaining({ code: 'interpolation.unknown_variable', path: 'path', message: 'unknown variable SESSION_SECRET' }),
    ]);
  });

  it('reports a required variable with its message', () => {
    const { issues } = run('${STRIPE_KEY:?set it in the project variables}');
    expect(issues).toEqual([
      expect.objectContaining({ code: 'interpolation.required_variable', message: 'STRIPE_KEY: set it in the project variables' }),
    ]);
  });

  it.each(['echo $1', '${NAME', '${1BAD}', '$ alone'])('rejects the invalid expression %j', (input) => {
    expect(run(input).issues).toEqual([expect.objectContaining({ code: 'interpolation.invalid' })]);
  });
});

describe('interpolateTree', () => {
  it('interpolates nested values without touching keys or the input', () => {
    const input = { services: { api: { environment: { $NAME: '${NAME}' }, command: ['echo', '$URL'], replicas: 1 } } };
    const issues: Issue[] = [];

    const output = interpolateTree(input, vars, '', issues);

    expect(output).toEqual({ services: { api: { environment: { $NAME: 'blog' }, command: ['echo', 'https://api.test'], replicas: 1 } } });
    expect(input.services.api.environment.$NAME).toBe('${NAME}');
    expect(issues).toEqual([]);
  });

  it('skips extension fields, which are dropped anyway', () => {
    const issues: Issue[] = [];
    interpolateTree({ 'x-notes': '${UNKNOWN}' }, vars, '', issues);
    expect(issues).toEqual([]);
  });

  it('reports the key path of the faulty value', () => {
    const issues: Issue[] = [];
    interpolateTree({ services: { api: { environment: ['A=${UNKNOWN}'] } } }, vars, '', issues);
    expect(issues[0].path).toBe('services.api.environment[0]');
  });
});
