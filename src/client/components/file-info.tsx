import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '@/client/api/client.js';
import { Info } from '@/client/components/icons.js';
import { bytes, plural, relativeTime } from '@/client/lib/format.js';
import { useReview } from '@/client/store/review.js';
import { Button, Skeleton } from '@/client/ui/index.js';
import type {
  FileHistoryInfo,
  FileInfoCommit,
  FileStatInfo,
} from '@/shared/protocol.js';

type Part<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

interface Parts {
  stat: Promise<FileStatInfo>;
  history: Promise<FileHistoryInfo>;
}

const cache = new Map<string, Parts>();

useReview.subscribe((s, prev) => {
  if (s.state?.version !== prev.state?.version) cache.clear();
});

const partsFor = (path: string): Parts => {
  const hit = cache.get(path);
  if (hit) return hit;
  const parts: Parts = {
    stat: api.fileStat(path),
    history: api.fileHistoryInfo(path),
  };
  cache.set(path, parts);
  parts.stat.catch(() => cache.delete(path));
  parts.history.catch(() => cache.delete(path));
  return parts;
};

function usePart<T>(promise: Promise<T>): Part<T> {
  const [part, setPart] = useState<Part<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    promise
      .then((data) => alive && setPart({ status: 'ready', data }))
      .catch(
        (e: Error) => alive && setPart({ status: 'error', message: e.message })
      );
    return () => {
      alive = false;
    };
  }, [promise]);
  return part;
}

function Value<T>({
  part,
  width,
  children,
}: {
  part: Part<T>;
  width: number;
  children: (data: T) => ReactNode;
}) {
  if (part.status === 'loading') return <Skeleton width={width} />;
  if (part.status === 'error')
    return <span className="info-error">{part.message}</span>;
  return <>{children(part.data)}</>;
}

function Commit({ label, c }: { label: string; c: FileInfoCommit }) {
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

function CommitSkeleton({ label }: { label: string }) {
  return (
    <div className="info-commit">
      <span className="info-key">{label}</span>
      <Skeleton width={200} />
      <Skeleton width={140} />
    </div>
  );
}

function Body({ path }: { path: string }) {
  const parts = partsFor(path);
  const stat = usePart(parts.stat);
  const history = usePart(parts.history);
  const untracked =
    stat.status === 'ready' &&
    !stat.data.tracked &&
    history.status === 'ready' &&
    history.data.commits === 0;
  return (
    <>
      <dl className="info-grid">
        <dt>Size</dt>
        <dd>
          <Value part={stat} width={48}>
            {(s) => (s.size === null ? 'missing' : bytes(s.size))}
          </Value>
        </dd>
        <dt>Blob</dt>
        <dd className="ui-mono">
          <Value part={stat} width={96}>
            {(s) => s.blob?.slice(0, 12) ?? 'not in HEAD'}
          </Value>
        </dd>
        <dt>Commits</dt>
        <dd>
          <Value part={history} width={32}>
            {(h) => (untracked ? 'untracked' : h.commits)}
          </Value>
        </dd>
        <dt>
          <Value part={history} width={56}>
            {(h) => plural(Math.max(h.authors.length, 1), 'author')}
          </Value>
        </dt>
        <dd className="info-authors">
          <Value part={history} width={120}>
            {(h) =>
              h.authors.length ? (
                <>
                  {h.authors.slice(0, 6).map((a) => (
                    <span key={a.name}>
                      {a.name} <span className="ui-muted">({a.commits})</span>
                    </span>
                  ))}
                  {h.authors.length > 6 && (
                    <span className="ui-muted">
                      +{h.authors.length - 6} more
                    </span>
                  )}
                </>
              ) : (
                <span className="ui-muted">none yet</span>
              )
            }
          </Value>
        </dd>
      </dl>
      {history.status === 'loading' && <CommitSkeleton label="Last change" />}
      {history.status === 'ready' && history.data.last && (
        <Commit label="Last change" c={history.data.last} />
      )}
      {history.status === 'ready' &&
        history.data.first &&
        history.data.first.sha !== history.data.last?.sha && (
          <Commit label="Introduced" c={history.data.first} />
        )}
    </>
  );
}

export function FileInfo({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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
          <Body path={path} />
        </div>
      )}
    </span>
  );
}
