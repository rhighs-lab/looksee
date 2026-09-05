import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseComparison } from '@/server/git/comparison.js';
import {
  type Comment,
  type Comparison,
  type Pin,
  type Review,
  SCOPE_PRESETS,
  type Session,
  VERDICTS,
  type Verdict,
} from '@/shared/protocol.js';

export const lookseeHome = (): string =>
  process.env['LOOKSEE_HOME'] || path.join(os.homedir(), '.looksee');

export async function writeFileAtomic(
  dest: string,
  data: string | Buffer
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const mode = await fs.stat(dest).then(
    (st) => st.mode,
    () => undefined
  );
  await fs.writeFile(tmp, data, mode === undefined ? {} : { mode });
  await fs.rename(tmp, dest);
}

export const writeJsonAtomic = (dest: string, data: unknown): Promise<void> =>
  writeFileAtomic(dest, JSON.stringify(data, null, 2));

export async function readJsonArray<T>(
  file: string,
  key: string
): Promise<T[]> {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as Record<
      string,
      unknown
    >;
    const list = data[key];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}

const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {})
  );
  return next;
}

export const repoKey = (repoRoot: string): string =>
  crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 16);

const fileFor = (repoRoot: string): string =>
  path.join(lookseeHome(), `${repoKey(repoRoot)}.json`);

type StoredComment = Partial<Comment> & { id: string };
type StoredReview = Partial<Review> & { id: string };

interface StoreData {
  reviews: Review[];
  comments: Comment[];
  session: Session | null;
}

const STORE_VERSION = 3;

const normAuthor = (a: unknown): string => {
  if (a === 'claude') return 'agent';
  return typeof a === 'string' && a ? a : 'user';
};

function normalize(c: StoredComment): Comment {
  return {
    id: c.id,
    repoRoot: c.repoRoot ?? '',
    parentId: c.parentId ?? null,
    author: normAuthor(c.author),
    filePath: c.filePath ?? '',
    side: c.side ?? 'new',
    startLine: c.startLine ?? 0,
    endLine: c.endLine ?? c.startLine ?? 0,
    body: c.body ?? '',
    branch: c.branch ?? null,
    lineSnapshot: Array.isArray(c.lineSnapshot) ? c.lineSnapshot : [],
    status: c.status === 'resolved' ? 'resolved' : 'open',
    reviewId: c.reviewId ?? null,
    applied: c.applied ?? null,
    createdAt: c.createdAt ?? new Date(0).toISOString(),
    updatedAt: c.updatedAt ?? c.createdAt ?? new Date(0).toISOString(),
  };
}

function normalizeReview(r: StoredReview): Review {
  return {
    id: r.id,
    repoRoot: r.repoRoot ?? '',
    author: normAuthor(r.author),
    branch: r.branch ?? null,
    state: r.state === 'submitted' ? 'submitted' : 'pending',
    verdict: r.verdict && VERDICTS.includes(r.verdict) ? r.verdict : null,
    body: r.body ?? '',
    createdAt: r.createdAt ?? new Date(0).toISOString(),
    submittedAt: r.submittedAt ?? null,
    comparison: r.comparison ?? null,
  };
}

const normPin = (p: unknown): Pin | null => {
  if (!p || typeof p !== 'object') return null;
  const { tree, head, at } = p as Partial<Pin>;
  return typeof tree === 'string' && tree
    ? { tree, head: head ?? '', at: at ?? new Date(0).toISOString() }
    : null;
};

function normalizeSession(s: unknown): Session | null {
  if (!s || typeof s !== 'object') return null;
  const x = s as Partial<Session>;
  return {
    openedAt: normPin(x.openedAt),
    approvedAt: normPin(x.approvedAt),
    scope: x.scope && SCOPE_PRESETS.includes(x.scope) ? x.scope : 'session',
    custom: parseComparison(x.custom),
    endedAt: x.endedAt ?? null,
  };
}

const list = <T>(val: unknown): T[] => (Array.isArray(val) ? (val as T[]) : []);

async function readStore(repoRoot: string): Promise<StoreData> {
  let raw: string;
  try {
    raw = await fs.readFile(fileFor(repoRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { reviews: [], comments: [], session: null };
    throw err;
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  return {
    reviews: list<StoredReview>(data['reviews']).map(normalizeReview),
    comments: list<StoredComment>(data['comments']).map(normalize),
    session: normalizeSession(data['session']),
  };
}

const writeStore = (repoRoot: string, data: StoreData) =>
  writeJsonAtomic(fileFor(repoRoot), {
    version: STORE_VERSION,
    repoRoot,
    ...data,
  });
const locked = <T>(repoRoot: string, fn: () => Promise<T>) =>
  withLock(`comments:${repoRoot}`, fn);

const visibleTo =
  (reviews: Review[], viewer: string | undefined) =>
  (c: Comment): boolean => {
    if (!c.reviewId) return true;
    const rv = reviews.find((r) => r.id === c.reviewId);
    return rv?.state !== 'pending' || rv.author === viewer;
  };

export async function listComments(
  repoRoot: string,
  branch: string | null,
  viewer?: string
): Promise<Comment[]> {
  const { reviews, comments } = await readStore(repoRoot);
  const all = comments.filter(visibleTo(reviews, viewer));
  return branch ? all.filter((c) => c.branch === branch) : all;
}

export type NewComment = Omit<
  Comment,
  'id' | 'repoRoot' | 'createdAt' | 'updatedAt' | 'status' | 'applied'
>;

export function addComment(
  repoRoot: string,
  data: NewComment
): Promise<Comment> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const now = new Date().toISOString();
    const comment: Comment = {
      ...data,
      id: crypto.randomUUID(),
      repoRoot,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      applied: null,
    };
    store.comments.push(comment);
    await writeStore(repoRoot, store);
    return comment;
  });
}

export async function getComment(
  repoRoot: string,
  id: string
): Promise<Comment | null> {
  const { comments } = await readStore(repoRoot);
  return comments.find((c) => c.id === id) ?? null;
}

export type CommentPatch = Partial<
  Pick<Comment, 'body' | 'status' | 'applied'>
>;

export function updateComment(
  repoRoot: string,
  id: string,
  patch: CommentPatch
): Promise<Comment | null> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const comment = store.comments.find((c) => c.id === id);
    if (!comment) return null;
    Object.assign(comment, patch, { updatedAt: new Date().toISOString() });
    await writeStore(repoRoot, store);
    return comment;
  });
}

export function deleteComment(repoRoot: string, id: string): Promise<number> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const all = store.comments;
    if (!all.some((c) => c.id === id)) return 0;
    store.comments = all.filter((c) => c.id !== id && c.parentId !== id);
    await writeStore(repoRoot, store);
    return all.length - store.comments.length;
  });
}

const lastCleared = new Map<string, Comment[]>();

export function clearComments(
  repoRoot: string,
  branch: string | null
): Promise<number> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const all = store.comments;
    const cleared = branch
      ? all.filter((c) => c.branch === branch)
      : all.slice();
    store.comments = branch ? all.filter((c) => c.branch !== branch) : [];
    lastCleared.set(repoRoot, cleared);
    await writeStore(repoRoot, store);
    return cleared.length;
  });
}

export function restoreCleared(repoRoot: string): Promise<number> {
  return locked(repoRoot, async () => {
    const cleared = lastCleared.get(repoRoot);
    if (!cleared?.length) return 0;
    const store = await readStore(repoRoot);
    store.comments.push(...cleared);
    lastCleared.delete(repoRoot);
    await writeStore(repoRoot, store);
    return cleared.length;
  });
}

export class PendingReviewError extends Error {
  readonly code = 'pending_review';
  readonly review: Review;
  constructor(review: Review) {
    super(`${review.author} already has a pending review`);
    this.name = 'PendingReviewError';
    this.review = review;
  }
}

export interface ReviewFilter {
  author?: string;
  state?: Review['state'];
  branch?: string | null;
}

export async function listReviews(
  repoRoot: string,
  filter: ReviewFilter = {}
): Promise<Review[]> {
  const { reviews } = await readStore(repoRoot);
  return reviews.filter(
    (r) =>
      (filter.author === undefined || r.author === filter.author) &&
      (filter.state === undefined || r.state === filter.state) &&
      (filter.branch === undefined || r.branch === filter.branch)
  );
}

export async function getReview(
  repoRoot: string,
  id: string
): Promise<Review | null> {
  const { reviews } = await readStore(repoRoot);
  return reviews.find((r) => r.id === id) ?? null;
}

export function startReview(
  repoRoot: string,
  data: { author: string; branch: string | null }
): Promise<Review> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const open = store.reviews.find(
      (r) => r.author === data.author && r.state === 'pending'
    );
    if (open) throw new PendingReviewError(open);
    const review: Review = {
      id: crypto.randomUUID(),
      repoRoot,
      author: data.author,
      branch: data.branch,
      state: 'pending',
      verdict: null,
      body: '',
      createdAt: new Date().toISOString(),
      submittedAt: null,
      comparison: null,
    };
    store.reviews.push(review);
    await writeStore(repoRoot, store);
    return review;
  });
}

export function submitReview(
  repoRoot: string,
  id: string,
  data: { verdict: Verdict; body: string; comparison?: Comparison | null }
): Promise<Review | null> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const review = store.reviews.find((r) => r.id === id);
    if (!review) return null;
    Object.assign(review, {
      state: 'submitted',
      verdict: data.verdict,
      body: data.body,
      submittedAt: new Date().toISOString(),
      comparison: data.comparison ?? null,
    });
    await writeStore(repoRoot, store);
    return review;
  });
}

export function discardReview(repoRoot: string, id: string): Promise<boolean> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    if (!store.reviews.some((r) => r.id === id)) return false;
    const gone = new Set(
      store.comments.filter((c) => c.reviewId === id).map((c) => c.id)
    );
    store.reviews = store.reviews.filter((r) => r.id !== id);
    store.comments = store.comments.filter(
      (c) => !gone.has(c.id) && !(c.parentId && gone.has(c.parentId))
    );
    await writeStore(repoRoot, store);
    return true;
  });
}

export async function getSession(repoRoot: string): Promise<Session | null> {
  return (await readStore(repoRoot)).session;
}

export function setSession<S extends Session | null>(
  repoRoot: string,
  fn: (cur: Session | null) => Promise<S>
): Promise<S> {
  return locked(repoRoot, async () => {
    const store = await readStore(repoRoot);
    const next = await fn(store.session);
    store.session = next;
    await writeStore(repoRoot, store);
    return next;
  });
}
