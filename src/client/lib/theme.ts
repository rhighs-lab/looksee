import type { Appearance, Theme } from '@/client/store/prefs.js';

export const THEME_LABEL: Record<Theme, string> = {
  github: 'GitHub',
  solarized: 'Solarized',
  atom: 'Atom One',
};

export const THEMES: Theme[] = ['github', 'solarized', 'atom'];
export const APPEARANCES: Appearance[] = ['auto', 'light', 'dark'];

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export const resolveMode = (a: Appearance): 'light' | 'dark' =>
  a === 'auto' ? (darkQuery().matches ? 'dark' : 'light') : a;

export function applyTheme(theme: Theme, appearance: Appearance): void {
  const mode = resolveMode(appearance);
  const el = document.documentElement;
  el.dataset['theme'] = theme;
  el.dataset['mode'] = mode;
  el.setAttribute('data-color-mode', mode);
}

export function watchSystemTheme(onChange: () => void): () => void {
  const q = darkQuery();
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}
