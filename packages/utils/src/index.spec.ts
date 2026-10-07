import { describe, expect, it } from 'vitest';
import { sanitizeGitBranch, sanitizeGitRepo } from './index';

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
