import { describe, expect, it } from 'vitest';
import { kindIcon } from '@/client/lib/kind-icon.js';

describe('kindIcon', () => {
  it('gives added, deleted, renamed and modified their own icon and tone', () => {
    expect(kindIcon('added')).toEqual({ icon: 'added', tone: 'success' });
    expect(kindIcon('deleted')).toEqual({ icon: 'removed', tone: 'danger' });
    expect(kindIcon('renamed')).toEqual({ icon: 'renamed', tone: 'accent' });
    expect(kindIcon('modified')).toEqual({
      icon: 'modified',
      tone: 'attention',
    });
  });

  it('folds copied and typechange into modified', () => {
    expect(kindIcon('copied').icon).toBe('modified');
    expect(kindIcon('typechange').icon).toBe('modified');
  });

  it('shows unmerged as modified in the danger tone', () => {
    expect(kindIcon('unmerged')).toEqual({ icon: 'modified', tone: 'danger' });
  });

  it('gives unchanged the plain file icon in the muted tone', () => {
    expect(kindIcon('unchanged')).toEqual({ icon: 'file', tone: 'muted' });
  });
});
