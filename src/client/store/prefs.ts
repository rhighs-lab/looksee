export type View = 'split' | 'unified';

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

const write = (key: string, val: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* storage unavailable */
  }
};

const repoKey = (repoRoot: string | null, name: string) =>
  `looksee:${name}:${repoRoot ?? 'sample'}`;

export const prefs = {
  view: (): View => read<View>('looksee:view', 'split'),
  setView: (v: View) => write('looksee:view', v),
  treeHidden: (): boolean => read('looksee:tree-hidden', false),
  setTreeHidden: (v: boolean) => write('looksee:tree-hidden', v),
  treeWidth: (): number | null => read<number | null>('looksee:tree-w', null),
  setTreeWidth: (v: number | null) => write('looksee:tree-w', v),
  viewed: (repoRoot: string | null): Record<string, string> =>
    read(repoKey(repoRoot, 'viewed'), {}),
  setViewed: (repoRoot: string | null, v: Record<string, string>) =>
    write(repoKey(repoRoot, 'viewed'), v),
  collapsed: (repoRoot: string | null): Record<string, boolean> =>
    read(repoKey(repoRoot, 'collapsed'), {}),
  setCollapsed: (repoRoot: string | null, v: Record<string, boolean>) =>
    write(repoKey(repoRoot, 'collapsed'), v),
};
