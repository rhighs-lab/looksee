import type { Tone } from '@/client/ui/index.js';
import type { ChangeKind } from '@/shared/protocol.js';
import { KIND_TONE } from './layers.js';

export type KindIconName =
  | 'added'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'file';

const ICON: Record<ChangeKind, KindIconName> = {
  added: 'added',
  modified: 'modified',
  deleted: 'removed',
  renamed: 'renamed',
  copied: 'modified',
  typechange: 'modified',
  unmerged: 'modified',
  unchanged: 'file',
};

export const kindIcon = (
  kind: ChangeKind
): { icon: KindIconName; tone: Tone } => ({
  icon: ICON[kind],
  tone: KIND_TONE[kind],
});
