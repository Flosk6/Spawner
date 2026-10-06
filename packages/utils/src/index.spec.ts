import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  sanitizeGitBranch,
  sanitizeGitRepo,
  sanitizeShellArg,
  validateEnvironmentName,
  validateResourceName,
  validateSafePath,
} from './index';

describe('sanitizeShellArg', () => {
  it('keeps plain arguments unchanged', () => {
    expect(sanitizeShellArg('my-resource_1.0')).toBe('my-resource_1.0');
  });

  it('removes every shell metacharacter', () => {
    const sanitized = sanitizeShellArg('a;b&c|d`e$f(g)h{i}j[k]l<m>n\\o"p\'q!r*s?t#u~v');
    expect(sanitized).toBe('abcdefghijklmnopqrstuv');
  });

  it('removes newlines and tabs', () => {
    expect(sanitizeShellArg('a\nb\rc\td')).toBe('abcd');
  });

  it('rejects empty, oversized or metacharacter-only input', () => {
    expect(() => sanitizeShellArg('')).toThrow();
    expect(() => sanitizeShellArg('a'.repeat(501))).toThrow(/too long/);
    expect(() => sanitizeShellArg(';|&')).toThrow(/empty after sanitization/);
  });
});

describe('sanitizeGitRepo', () => {
  it.each([
    'git@github.com:acme/api.git',
    'https://github.com/acme/api.git',
    'git@gitlab.example.com:group/sub/repo-name.git',
  ])('accepts %s', (repo) => {
    expect(sanitizeGitRepo(repo)).toBe(repo);
  });

  it.each([
    'file:///etc/passwd',
    'ext::sh -c touch% /tmp/pwned',
    '--upload-pack=touch /tmp/pwned',
    'git@github.com:acme/api.git; rm -rf /',
    'git@github.com:acme/api',
    'ssh://git@github.com/acme/api.git',
  ])('rejects %s', (repo) => {
    expect(() => sanitizeGitRepo(repo)).toThrow();
  });
});

describe('sanitizeGitBranch', () => {
  it.each(['main', 'develop', 'feature/auth-123', 'release/1.2.0', 'fix_bug'])('accepts %s', (branch) => {
    expect(sanitizeGitBranch(branch)).toBe(branch);
  });

  it.each([
    '-x',
    '--orphan',
    '../../../etc/passwd',
    'feature/../main',
    'a b',
    'a;b',
    '$(touch x)',
    'branch@{1}',
    'a\\b',
    '',
  ])('rejects %j', (branch) => {
    expect(() => sanitizeGitBranch(branch)).toThrow();
  });
});

describe('validateSafePath', () => {
  const base = path.resolve('/opt/spawner/repos');

  it('resolves a nested relative path inside the base directory', () => {
    expect(validateSafePath('api/.spawner/Dockerfile', base)).toBe(path.join(base, 'api/.spawner/Dockerfile'));
  });

  it.each(['../etc/passwd', 'api/../../etc', '/etc/passwd', '~/secrets'])('rejects %s', (filePath) => {
    expect(() => validateSafePath(filePath, base)).toThrow();
  });
});

describe('validateResourceName', () => {
  it.each(['api', 'front_v2', 'main-db'])('accepts %s', (name) => {
    expect(validateResourceName(name)).toBe(name);
  });

  it.each(['', 'a/b', 'a.b', 'evil/../../etc', 'a b', 'x'.repeat(101)])('rejects %j', (name) => {
    expect(() => validateResourceName(name)).toThrow();
  });
});

describe('validateEnvironmentName', () => {
  it('accepts lowercase letters, digits and dashes only', () => {
    expect(validateEnvironmentName('feature-123')).toBe(true);
    expect(validateEnvironmentName('Feature')).toBe(false);
    expect(validateEnvironmentName('feat/login')).toBe(false);
    expect(validateEnvironmentName('feat_login')).toBe(false);
  });
});
