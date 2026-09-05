import fs from 'node:fs/promises';
import path from 'node:path';
import { lookseeHome, writeJsonAtomic } from '@/server/review/store.js';
import {
  APPEARANCES,
  type Appearance,
  THEMES,
  type Theme,
  type UiPrefs,
} from '@/shared/protocol.js';

const file = (): string => path.join(lookseeHome(), 'ui-prefs.json');

const pick = <T extends string>(vals: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (vals as readonly string[]).includes(v)
    ? (v as T)
    : null;

export const theme = (v: unknown): Theme | null => pick(THEMES, v);
export const appearance = (v: unknown): Appearance | null =>
  pick(APPEARANCES, v);

export async function readUiPrefs(): Promise<UiPrefs> {
  const raw = await fs
    .readFile(file(), 'utf8')
    .then((t) => JSON.parse(t) as Record<string, unknown>)
    .catch(() => ({}) as Record<string, unknown>);
  return {
    theme: theme(raw['theme']),
    appearance: appearance(raw['appearance']),
  };
}

export async function writeUiPrefs(patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const next: UiPrefs = { ...(await readUiPrefs()) };
  if (patch.theme) next.theme = patch.theme;
  if (patch.appearance) next.appearance = patch.appearance;
  await writeJsonAtomic(file(), next);
  return next;
}
