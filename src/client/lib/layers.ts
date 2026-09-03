import type { Tone } from '@/client/ui/index.js';
import type { ChangedFile, ChangeKind, Layer } from '@/shared/protocol.js';
import {
  KIND_LABEL,
  LAYER_HINT,
  LAYER_LABEL,
  LAYERS,
} from '@/shared/protocol.js';

export const LAYER_GLYPH: Record<Layer, string> = {
  pushed: 'P',
  local: 'L',
  staged: 'S',
  unstaged: 'U',
  untracked: '?',
  conflicted: '!',
};

export const LAYER_TONE: Record<Layer, Tone> = {
  pushed: 'done',
  local: 'accent',
  staged: 'success',
  unstaged: 'attention',
  untracked: 'muted',
  conflicted: 'danger',
};

export const KIND_GLYPH: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unmerged: '!',
  unchanged: '·',
};

export const KIND_TONE: Record<ChangeKind, Tone> = {
  added: 'success',
  modified: 'attention',
  deleted: 'danger',
  renamed: 'accent',
  copied: 'accent',
  typechange: 'accent',
  unmerged: 'danger',
  unchanged: 'muted',
};

export const kindLabel = (k: ChangeKind): string => KIND_LABEL[k];

export function layersOf(file: ChangedFile): Layer[] {
  const present = new Set(file.layers.map((l) => l.layer));
  return LAYERS.filter((l) => present.has(l));
}

export const layerTitle = (l: Layer): string =>
  `${LAYER_LABEL[l]}: ${LAYER_HINT[l]}`;
