import fs from 'node:fs/promises';
import { getBlobText, splitLines } from '@/server/git/blobs.js';
import { insideRepo, safeRelPath } from '@/server/git/paths.js';
import {
  isSuggestionRoot,
  kindOf,
  renderCommentHtml,
} from '@/server/review/markdown.js';
import {
  getComment,
  updateComment,
  withLock,
  writeFileAtomic,
} from '@/server/review/store.js';
import { parseSuggestions } from '@/server/review/suggestion.js';
import type { Comment, DecoratedComment } from '@/shared/protocol.js';

const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((l, i) => l === b[i]);

export type Decorator = (c: Comment) => Promise<DecoratedComment>;

export function decorator(repoRoot: string | null): Decorator {
  const files = new Map<string, Promise<string[]>>();
  const linesOf = async (c: Comment): Promise<string[]> => {
    if (!repoRoot) return [];
    if (!files.has(c.filePath)) {
      files.set(
        c.filePath,
        getBlobText(repoRoot, 'WORKTREE', c.filePath)
          .then((t) => splitLines(t).map((l) => l.replace(/\r$/, '')))
          .catch(() => [])
      );
    }
    const all = await files.get(c.filePath)!;
    return all.slice(c.startLine - 1, c.endLine);
  };
  return async (c) => {
    const sugs = isSuggestionRoot(c) ? parseSuggestions(c.body) : [];
    const sug = sugs[0] ?? null;
    const kind = kindOf(c, sugs);
    if (!sug)
      return {
        ...c,
        kind,
        bodyHtml: renderCommentHtml(c),
        suggestion: null,
        applicable: null,
      };
    const snapshot = c.lineSnapshot;
    const cur = repoRoot && safeRelPath(c.filePath) ? await linesOf(c) : [];
    const applicable = snapshot.length > 0 && sameLines(cur, snapshot);
    return {
      ...c,
      bodyHtml: renderCommentHtml(c, {
        snapshot,
        applicable,
        handoff: c.handoff,
        applied: Boolean(c.applied),
      }),
      kind,
      suggestion: { lines: sug.lines },
      applicable,
    };
  };
}

export type ApplyResult =
  | { status: 200; comment: Comment; path: string }
  | { status: 400 | 404 | 409; error: string; outdated?: boolean };

async function applyLocked(repoRoot: string, id: string): Promise<ApplyResult> {
  const c = await getComment(repoRoot, id);
  if (!c) return { status: 404, error: 'not found' };
  if (!isSuggestionRoot(c))
    return { status: 400, error: 'not a new-side line comment' };
  const sug = parseSuggestions(c.body)[0];
  if (!sug) return { status: 400, error: 'no suggestion' };
  const rel = safeRelPath(c.filePath);
  const abs = rel && insideRepo(repoRoot, rel);
  if (!rel || !abs) return { status: 400, error: 'invalid path' };
  if (c.applied)
    return { status: 409, error: 'already applied', outdated: true };
  if (c.handoff === 'agent')
    return { status: 409, error: 'handed off to agent', outdated: true };
  let text: string;
  try {
    text = await fs.readFile(abs, 'utf8');
  } catch {
    return { status: 409, error: 'file missing', outdated: true };
  }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = text.endsWith('\n');
  const all = splitLines(trailing ? text : `${text}\n`).map((l) =>
    l.replace(/\r$/, '')
  );
  const cur = all.slice(c.startLine - 1, c.endLine);
  if (!c.lineSnapshot.length || !sameLines(cur, c.lineSnapshot))
    return { status: 409, error: 'outdated', outdated: true };
  const next = [
    ...all.slice(0, c.startLine - 1),
    ...sug.lines,
    ...all.slice(c.endLine),
  ];
  await writeFileAtomic(abs, next.join(nl) + (trailing ? nl : ''));
  const comment = await updateComment(repoRoot, c.id, {
    status: 'resolved',
    applied: { at: new Date().toISOString(), lines: sug.lines },
  });
  return { status: 200, comment: comment!, path: rel };
}

export const applySuggestion = (
  repoRoot: string,
  id: string
): Promise<ApplyResult> =>
  withLock(`apply:${repoRoot}`, () => applyLocked(repoRoot, id));
