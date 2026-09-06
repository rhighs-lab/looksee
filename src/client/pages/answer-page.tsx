import { useEffect, useMemo, useState } from 'react';
import { api } from '@/client/api/client.js';
import { AnswerCard, hitAnchor } from '@/client/components/answer-card.js';
import { ArrowLeft, File as FileIcon } from '@/client/components/icons.js';
import { Loading } from '@/client/components/loading.js';
import {
  TreeDirNode,
  TreePane,
  useSubnavHeight,
} from '@/client/components/tree-pane.js';
import { relativeTime } from '@/client/lib/format.js';
import { buildTree } from '@/client/lib/tree.js';
import { Counter, Notice } from '@/client/ui/index.js';
import type { AnswerHit, DecoratedAnswer } from '@/shared/protocol.js';

interface Placed {
  hit: AnswerHit;
  index: number;
}

export function AnswerPage({ id }: { id: string }) {
  useSubnavHeight();
  const [answer, setAnswer] = useState<DecoratedAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .answer(id)
      .then((r) => alive && setAnswer(r.answer))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const placed = useMemo<Placed[]>(
    () => (answer?.hits ?? []).map((hit, index) => ({ hit, index })),
    [answer]
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return placed;
    return placed.filter(
      (p) =>
        p.hit.path.toLowerCase().includes(q) ||
        (p.hit.symbol ?? '').toLowerCase().includes(q)
    );
  }, [placed, filter]);
  const tree = useMemo(() => buildTree(shown, (p) => p.hit.path), [shown]);

  useEffect(() => {
    if (!answer) return;
    const cards = [...document.querySelectorAll<HTMLElement>('.answer-card')];
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((e) => e.isIntersecting);
        if (!seen) return;
        const n = Number(seen.target.id.split('-h').pop());
        if (Number.isFinite(n)) setActive(n);
      },
      { rootMargin: '-30% 0px -55% 0px' }
    );
    for (const c of cards) io.observe(c);
    return () => io.disconnect();
  }, [answer]);

  const files = new Set(placed.map((p) => p.hit.path)).size;

  const renderFile = ({ hit, index }: Placed, name: string, depth: number) => (
    <a
      key={`${hit.path}-${index}`}
      className={`tree-row tree-file-row${active === index ? ' is-active' : ''}`}
      href={`#${hitAnchor(hit, index)}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      title={hit.why ?? hit.path}
      onClick={() => setActive(index)}
    >
      <span className="kind-icon ui-status-neutral">
        <FileIcon width={14} height={14} />
      </span>
      <span className="tree-name">{name}</span>
      {hit.symbol && <span className="tree-symbol">{hit.symbol}</span>}
      <span className="tree-counts ui-mono">{hit.startLine}</span>
    </a>
  );

  return (
    <>
      <header className="pr-subnav">
        <div className="pr-subnav-inner">
          <div className="pr-title-row">
            <a className="back-link" href="/">
              <ArrowLeft width={14} height={14} />
              Review
            </a>
            <h1 className="pr-title">{answer?.question ?? 'Answer'}</h1>
            {answer && <Counter n={answer.hits.length} />}
          </div>
          {answer && (
            <div className="pr-meta-row">
              <span className="ui-muted">
                {answer.hits.length}{' '}
                {answer.hits.length === 1 ? 'place' : 'places'} in {files}{' '}
                {files === 1 ? 'file' : 'files'} · answered by {answer.author} ·{' '}
                {relativeTime(answer.createdAt)}
              </span>
            </div>
          )}
          {answer?.summary && (
            <div
              className="answer-summary comment-body"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by the server renderer
              dangerouslySetInnerHTML={{ __html: answer.summaryHtml }}
            />
          )}
        </div>
      </header>
      <div className="review-layout">
        {placed.length > 0 && (
          <TreePane
            header="Places"
            search={{
              value: filter,
              onChange: setFilter,
              placeholder: 'Filter places',
            }}
          >
            {shown.length === 0 ? (
              <div className="tree-empty">No place matches “{filter}”</div>
            ) : (
              <TreeDirNode node={tree} depth={0} renderFile={renderFile} />
            )}
          </TreePane>
        )}
        <main className="diff-container">
          {error && <Notice tone="danger">{error}</Notice>}
          {!answer && !error && <Loading label="Reading the answer…" />}
          {shown.map(({ hit, index }) => (
            <AnswerCard key={`${hit.path}-${index}`} hit={hit} index={index} />
          ))}
        </main>
      </div>
    </>
  );
}
