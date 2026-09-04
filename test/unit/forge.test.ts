import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { fileUrl, parseRemote } from '@/shared/forge.js';

describe('parseRemote', () => {
  it('reads an https remote', () => {
    assert.deepEqual(parseRemote('https://github.com/acme/looksee.git'), {
      host: 'github.com',
      owner: 'acme',
      repo: 'looksee',
    });
  });

  it('reads an scp-style ssh remote', () => {
    assert.deepEqual(parseRemote('git@github.com:acme/looksee.git'), {
      host: 'github.com',
      owner: 'acme',
      repo: 'looksee',
    });
  });

  it('reads an ssh:// remote with a port', () => {
    assert.deepEqual(parseRemote('ssh://git@github.com:22/acme/looksee'), {
      host: 'github.com',
      owner: 'acme',
      repo: 'looksee',
    });
  });

  it('keeps nested gitlab groups in the owner', () => {
    assert.deepEqual(parseRemote('git@gitlab.com:team/sub/app.git'), {
      host: 'gitlab.com',
      owner: 'team/sub',
      repo: 'app',
    });
  });

  it('returns null for hosts it cannot link to', () => {
    assert.equal(parseRemote('git@bitbucket.org:acme/looksee.git'), null);
    assert.equal(parseRemote('/srv/git/looksee.git'), null);
    assert.equal(parseRemote('https://github.com/acme'), null);
  });
});

describe('fileUrl', () => {
  const repo = { host: 'github.com', owner: 'acme', repo: 'looksee' };

  it('builds a blob url for a branch', () => {
    assert.equal(
      fileUrl(repo, 'main', 'src/cli/args.ts'),
      'https://github.com/acme/looksee/blob/main/src/cli/args.ts'
    );
  });

  it('appends a line anchor', () => {
    assert.equal(
      fileUrl(repo, 'main', 'src/a.ts', 12),
      'https://github.com/acme/looksee/blob/main/src/a.ts#L12'
    );
  });

  it('encodes refs and path segments separately', () => {
    assert.equal(
      fileUrl(repo, 'feat/x', 'a b/c#d.ts'),
      'https://github.com/acme/looksee/blob/feat%2Fx/a%20b/c%23d.ts'
    );
  });
});
