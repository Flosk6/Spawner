import { describe, expect, it } from 'vitest';
import { ErrorLineFilter, isErrorLine, matchesGrep } from './logs';

describe('isErrorLine', () => {
  it.each([
    "TypeError: Cannot read properties of undefined (reading 'id')",
    '2026-10-07 10:00:00.123 UTC [42] ERROR:  relation "users" does not exist',
    '[2026-10-07 10:00:00] local.ERROR: SQLSTATE[HY000] [2002] Connection refused',
    'panic: runtime error: invalid memory address',
    'Traceback (most recent call last):',
    'java.lang.NullPointerException: name is null',
    'UnhandledPromiseRejection: boom',
    '2026/10/07 10:00:00 [crit] 29#29: *1 connect() failed',
    '{"level":50,"msg":"request failed"}',
    '{"level":"error","message":"timeout"}',
    '{"severity":"CRITICAL","message":"disk full"}',
    '{"log":{"level":"error"},"message":"x"}',
  ])('flags %s', (line) => {
    expect(isErrorLine(line)).toBe(true);
  });

  it.each([
    '2026-10-07 10:00:00.123 UTC [1] LOG:  database system is ready to accept connections',
    'Listening on port 3000',
    '{"level":30,"msg":"request completed, 0 errors so far"}',
    '{"level":"info","message":"retrying after error"}',
    '{"msg":"no level here"}',
  ])('lets %s through', (line) => {
    expect(isErrorLine(line)).toBe(false);
  });
});

describe('ErrorLineFilter', () => {
  it('keeps the lines of a stack trace, service by service', () => {
    const lines = [
      { service: 'api', text: 'GET /users 200' },
      { service: 'api', text: 'Error: boom' },
      { service: 'db', text: 'checkpoint starting' },
      { service: 'api', text: '    at handler (/app/server.js:10:11)' },
      { service: 'api', text: '    at process (/app/node_modules/x.js:1:1)' },
      { service: 'api', text: 'GET /health 200' },
      { service: 'api', text: '    indented, after a normal line' },
    ];
    const filter = new ErrorLineFilter();
    expect(lines.filter((line) => filter.accept(line)).map((line) => line.text)).toEqual([
      'Error: boom',
      '    at handler (/app/server.js:10:11)',
      '    at process (/app/node_modules/x.js:1:1)',
    ]);
  });

  it('sees the indented lines of an error as its continuation, even when they mention errors', () => {
    const filter = new ErrorLineFilter();
    const kinds = ['error: relation "users" does not exist', '    at Parser.parseErrorMessage (parser.js:1:1)', "  severity: 'ERROR',", '}', 'GET / 200'].map(
      (text) => filter.classify({ service: 'app', text }),
    );
    expect(kinds).toEqual(['error', 'continuation', 'continuation', null, null]);
  });

  it('keeps a Python traceback whole', () => {
    const lines = ['Traceback (most recent call last):', '  File "/app/main.py", line 3, in <module>', '    1 / 0', 'ZeroDivisionError: division by zero'];
    const filter = new ErrorLineFilter();
    expect(lines.filter((text) => filter.accept({ service: 'app', text }))).toHaveLength(4);
  });
});

describe('matchesGrep', () => {
  it('ignores case', () => {
    expect(matchesGrep('POST /api/Users 500', 'users')).toBe(true);
    expect(matchesGrep('POST /api/orders 500', 'users')).toBe(false);
  });
});
