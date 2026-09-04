import { useEffect, useRef, useState } from 'react';
import { api } from '@/client/api/client.js';
import { Info } from '@/client/components/icons.js';
import { bytes, plural, relativeTime } from '@/client/lib/format.js';
import { Button } from '@/client/ui/index.js';
import type { FileInfoResponse } from '@/shared/protocol.js';

function Commit({
  label,
  c,
}: {
  label: string;
  c: NonNullable<FileInfoResponse['first']>;
}) {
  return (
    <div className="info-commit">
      <span className="info-key">{label}</span>
      <span className="info-commit-subject" title={c.subject}>
        {c.subject}
      </span>
      <span className="info-commit-meta ui-muted">
        <span className="ui-mono">{c.sha.slice(0, 7)}</span> · {c.author} ·{' '}
        {relativeTime(c.date)}
      </span>
    </div>
  );
}

function Body({ info }: { info: FileInfoResponse }) {
  return (
    <>
      <dl className="info-grid">
        {info.size !== null && (
          <>
            <dt>Size</dt>
            <dd>{bytes(info.size)}</dd>
          </>
        )}
        {info.blob && (
          <>
            <dt>Blob</dt>
            <dd className="ui-mono">{info.blob.slice(0, 12)}</dd>
          </>
        )}
        <dt>Commits</dt>
        <dd>{info.tracked ? info.commits : 'untracked'}</dd>
        {info.authors.length > 0 && (
          <>
            <dt>{plural(info.authors.length, 'author')}</dt>
            <dd className="info-authors">
              {info.authors.slice(0, 6).map((a) => (
                <span key={a.name}>
                  {a.name} <span className="ui-muted">({a.commits})</span>
                </span>
              ))}
              {info.authors.length > 6 && (
                <span className="ui-muted">
                  +{info.authors.length - 6} more
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
      {info.last && <Commit label="Last change" c={info.last} />}
      {info.first && info.first.sha !== info.last?.sha && (
        <Commit label="Introduced" c={info.first} />
      )}
    </>
  );
}

export function FileInfo({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<FileInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || info) return;
    let alive = true;
    api
      .fileInfo(path)
      .then((r) => alive && setInfo(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, info, path]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="file-info-pop" ref={ref}>
      <Button
        variant="invisible"
        icon
        small
        title="File details"
        aria-label="File details"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Info />
      </Button>
      {open && (
        <div className="menu info-card" role="dialog" aria-label="File details">
          <div className="info-path ui-mono">{path}</div>
          {error && <div className="info-error">{error}</div>}
          {!info && !error && <div className="ui-muted">Reading history…</div>}
          {info && <Body info={info} />}
        </div>
      )}
    </span>
  );
}
