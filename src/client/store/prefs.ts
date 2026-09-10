import {
  type CodeFont,
  isCodeFont,
  isProseFont,
  type ProseFont,
} from '@/client/lib/fonts.js';
import type { Appearance, ScopePreset, Theme } from '@/shared/protocol.js';

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
  theme: (): Theme => read<Theme>('looksee:theme', 'github'),
  setTheme: (v: Theme) => write('looksee:theme', v),
  appearance: (): Appearance => read<Appearance>('looksee:appearance', 'auto'),
  setAppearance: (v: Appearance) => write('looksee:appearance', v),
  proseFont: (): ProseFont => {
    const v = read<unknown>('looksee:prose-font', 'charter');
    return isProseFont(v) ? v : 'charter';
  },
  setProseFont: (v: ProseFont) => write('looksee:prose-font', v),
  codeFont: (): CodeFont => {
    const v = read<unknown>('looksee:code-font', 'system');
    return isCodeFont(v) ? v : 'system';
  },
  setCodeFont: (v: CodeFont) => write('looksee:code-font', v),
  newLineAttention: (): boolean => read('looksee:new-line-attention', false),
  setNewLineAttention: (v: boolean) => write('looksee:new-line-attention', v),
  setView: (v: View) => write('looksee:view', v),
  colorByLayer: (): boolean => read('looksee:colorByLayer', false),
  setColorByLayer: (v: boolean) => write('looksee:colorByLayer', v),
  treeHidden: (): boolean => read('looksee:tree-hidden', false),
  setTreeHidden: (v: boolean) => write('looksee:tree-hidden', v),
  treeWidth: (): number | null => read<number | null>('looksee:tree-w', null),
  setTreeWidth: (v: number | null) => write('looksee:tree-w', v),
  viewed: (repoRoot: string | null): Record<string, string> =>
    read(repoKey(repoRoot, 'viewed'), {}),
  setViewed: (repoRoot: string | null, v: Record<string, string>) =>
    write(repoKey(repoRoot, 'viewed'), v),
  scope: (repoRoot: string | null): ScopePreset | null =>
    read<ScopePreset | null>(repoKey(repoRoot, 'scope'), null),
  setScope: (repoRoot: string | null, v: ScopePreset) =>
    write(repoKey(repoRoot, 'scope'), v),
  commentsHidden: (repoRoot: string | null): boolean =>
    read(repoKey(repoRoot, 'comments-hidden'), false),
  setCommentsHidden: (repoRoot: string | null, v: boolean) =>
    write(repoKey(repoRoot, 'comments-hidden'), v),
  collapsed: (repoRoot: string | null): Record<string, boolean> =>
    read(repoKey(repoRoot, 'collapsed'), {}),
  setCollapsed: (repoRoot: string | null, v: Record<string, boolean>) =>
    write(repoKey(repoRoot, 'collapsed'), v),
};
