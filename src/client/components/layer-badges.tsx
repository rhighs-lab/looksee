import {
  KIND_GLYPH,
  KIND_TONE,
  kindLabel,
  LAYER_GLYPH,
  LAYER_TONE,
  layersOf,
  layerTitle,
} from '@/client/lib/layers.js';
import { Label, StatusGroup, StatusLetter } from '@/client/ui/index.js';
import type { ChangedFile, ChangeKind, Layer } from '@/shared/protocol.js';
import { LAYER_LABEL } from '@/shared/protocol.js';

export function LayerLetters({ file }: { file: ChangedFile }) {
  const layers = layersOf(file);
  if (!layers.length) return null;
  return (
    <StatusGroup
      label={`Git layers: ${layers.map((l) => LAYER_LABEL[l]).join(', ')}`}
    >
      {layers.map((l) => (
        <StatusLetter
          key={l}
          letter={LAYER_GLYPH[l]}
          tone={LAYER_TONE[l]}
          label={LAYER_LABEL[l]}
          title={layerTitle(l)}
        />
      ))}
    </StatusGroup>
  );
}

export function LayerLabels({ file }: { file: ChangedFile }) {
  const layers = layersOf(file);
  if (!layers.length) return null;
  return (
    <span
      className="layer-labels"
      role="group"
      aria-label={`Git layers: ${layers.map((l) => LAYER_LABEL[l]).join(', ')}`}
    >
      {layers.map((l) => (
        <LayerLabel key={l} layer={l} />
      ))}
    </span>
  );
}

export function LayerLabel({ layer }: { layer: Layer }) {
  return (
    <Label tone={LAYER_TONE[layer]} title={layerTitle(layer)}>
      <span className="ui-mono">{LAYER_GLYPH[layer]}</span>
      {LAYER_LABEL[layer]}
    </Label>
  );
}

export function KindLetter({ kind }: { kind: ChangeKind }) {
  return (
    <StatusLetter
      letter={KIND_GLYPH[kind]}
      tone={KIND_TONE[kind]}
      label={kindLabel(kind)}
    />
  );
}
