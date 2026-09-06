import { describe, expect, it } from 'vitest';
import { tildify } from '@/shared/home.js';

describe('tildify', () => {
  it('abbreviates a path under the home directory', () => {
    expect(tildify('/Users/me/repos/x', '/Users/me')).toBe('~/repos/x');
  });

  it('abbreviates the home directory itself', () => {
    expect(tildify('/Users/me', '/Users/me')).toBe('~');
  });

  it('tolerates a trailing slash on home', () => {
    expect(tildify('/Users/me/x', '/Users/me/')).toBe('~/x');
  });

  it('leaves a path outside home alone', () => {
    expect(tildify('/Users/meadow/x', '/Users/me')).toBe('/Users/meadow/x');
    expect(tildify('/srv/repo', '/Users/me')).toBe('/srv/repo');
  });

  it('passes null and a root home through', () => {
    expect(tildify(null, '/Users/me')).toBeNull();
    expect(tildify('/srv/repo', '/')).toBe('/srv/repo');
    expect(tildify('/srv/repo', null)).toBe('/srv/repo');
  });
});
