import { useState } from 'react';
import { imageTypeOf } from '@/shared/media.js';
import type { ChangedFile, Scope } from '@/shared/protocol.js';

export const rawHref = (
  filePath: string,
  scope: Scope,
  side?: 'old' | 'new'
): string =>
  `/api/raw?path=${encodeURIComponent(filePath)}&scope=${scope}${side ? `&side=${side}` : ''}`;

export const isImage = (filePath: string): boolean =>
  imageTypeOf(filePath) !== null;

function Side({
  label,
  href,
  alt,
  tone,
}: {
  label: string | null;
  href: string;
  alt: string;
  tone: 'del' | 'add' | 'plain';
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return (
    <div className={`image-side image-side-${tone}`}>
      {label && <span className="image-side-label">{label}</span>}
      <div className={`image-plate is-${state}`}>
        {state === 'failed' ? (
          <span className="image-failed">Could not read this image</span>
        ) : (
          <img
            src={href}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setState('ready')}
            onError={() => setState('failed')}
          />
        )}
      </div>
    </div>
  );
}

export function ImageDiff({
  file,
  scope,
}: {
  file: ChangedFile;
  scope: Scope;
}) {
  const oldPath = file.oldPath ?? file.path;
  const showOld = file.kind !== 'added';
  const showNew = file.kind !== 'deleted';
  return (
    <div className="image-pair">
      {showOld && (
        <Side
          label={showNew ? 'Before' : null}
          href={rawHref(oldPath, scope, 'old')}
          alt={oldPath}
          tone="del"
        />
      )}
      {showNew && (
        <Side
          label={showOld ? 'After' : null}
          href={rawHref(file.path, scope, 'new')}
          alt={file.path}
          tone="add"
        />
      )}
    </div>
  );
}
