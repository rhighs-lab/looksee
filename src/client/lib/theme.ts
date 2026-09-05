import type { Appearance, Theme } from '@/shared/protocol.js';
import { DARK_ONLY_THEMES, THEMES as THEME_LIST } from '@/shared/protocol.js';

export const THEME_LABEL: Record<Theme, string> = {
  github: 'GitHub',
  solarized: 'Solarized',
  atom: 'Atom One',
  darkened: 'Darkened',
  dracula: 'Dracula',
  nord: 'Nord',
  tokyo: 'Tokyo Night',
  catppuccin: 'Catppuccin',
  everforest: 'Everforest',
};

export const THEMES: Theme[] = [...THEME_LIST];

export const isDarkOnly = (t: Theme): boolean =>
  (DARK_ONLY_THEMES as readonly string[]).includes(t);
export const APPEARANCES: Appearance[] = ['auto', 'light', 'dark'];

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export const resolveMode = (a: Appearance): 'light' | 'dark' =>
  a === 'auto' ? (darkQuery().matches ? 'dark' : 'light') : a;

export function applyTheme(theme: Theme, appearance: Appearance): void {
  const mode = isDarkOnly(theme) ? 'dark' : resolveMode(appearance);
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
