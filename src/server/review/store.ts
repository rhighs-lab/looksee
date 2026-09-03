import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Comment } from '@/shared/protocol.js';

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

function fileFor(repoRoot: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(repoRoot)
    .digest('hex')
    .slice(0, 16);
  return path.join(lookseeHome(), `${hash}.json`);
}

type Stored = Partial<Comment> & { id: string };

function normalize(c: Stored): Comment {
  return {
    id: c.id,
    repoRoot: c.repoRoot ?? '',
    parentId: c.parentId ?? null,
    author: c.author === 'claude' ? 'claude' : 'user',
    filePath: c.filePath ?? '',
    side: c.side ?? 'new',
    startLine: c.startLine ?? 0,
    endLine: c.endLine ?? c.startLine ?? 0,
    body: c.body ?? '',
    branch: c.branch ?? null,
    lineSnapshot: Array.isArray(c.lineSnapshot) ? c.lineSnapshot : [],
    status: c.status === 'resolved' ? 'resolved' : 'open',
    handoff: c.handoff === 'agent' ? 'agent' : null,
    applied: c.applied ?? null,
    createdAt: c.createdAt ?? new Date(0).toISOString(),
    updatedAt: c.updatedAt ?? c.createdAt ?? new Date(0).toISOString(),
  };
}

const readAll = async (repoRoot: string): Promise<Comment[]> =>
  (await readJsonArray<Stored>(fileFor(repoRoot), 'comments')).map(normalize);
const writeAll = (repoRoot: string, comments: Comment[]) =>
  writeJsonAtomic(fileFor(repoRoot), { repoRoot, comments });
const locked = <T>(repoRoot: string, fn: () => Promise<T>) =>
  withLock(`comments:${repoRoot}`, fn);

export async function listComments(
  repoRoot: string,
  branch: string | null
): Promise<Comment[]> {
  const all = await readAll(repoRoot);
  return branch ? all.filter((c) => c.branch === branch) : all;
}

export type NewComment = Omit<
  Comment,
  | 'id'
  | 'repoRoot'
  | 'createdAt'
  | 'updatedAt'
  | 'status'
  | 'handoff'
  | 'applied'
>;

export function addComment(
  repoRoot: string,
  data: NewComment
): Promise<Comment> {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    const now = new Date().toISOString();
    const comment: Comment = {
      ...data,
      id: crypto.randomUUID(),
      repoRoot,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      handoff: null,
      applied: null,
    };
    all.push(comment);
    await writeAll(repoRoot, all);
    return comment;
  });
}

export async function getComment(
  repoRoot: string,
  id: string
): Promise<Comment | null> {
  const all = await readAll(repoRoot);
  return all.find((c) => c.id === id) ?? null;
}

export type CommentPatch = Partial<
  Pick<Comment, 'body' | 'status' | 'handoff' | 'applied'>
>;

export function updateComment(
  repoRoot: string,
  id: string,
  patch: CommentPatch
): Promise<Comment | null> {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    const comment = all.find((c) => c.id === id);
    if (!comment) return null;
    Object.assign(comment, patch, { updatedAt: new Date().toISOString() });
    await writeAll(repoRoot, all);
    return comment;
  });
}

export function deleteComment(repoRoot: string, id: string): Promise<number> {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    if (!all.some((c) => c.id === id)) return 0;
    const kept = all.filter((c) => c.id !== id && c.parentId !== id);
    await writeAll(repoRoot, kept);
    return all.length - kept.length;
  });
}

const lastCleared = new Map<string, Comment[]>();

export function clearComments(
  repoRoot: string,
  branch: string | null
): Promise<number> {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    const cleared = branch
      ? all.filter((c) => c.branch === branch)
      : all.slice();
    const kept = branch ? all.filter((c) => c.branch !== branch) : [];
    lastCleared.set(repoRoot, cleared);
    await writeAll(repoRoot, kept);
    return cleared.length;
  });
}

export function restoreCleared(repoRoot: string): Promise<number> {
  return locked(repoRoot, async () => {
    const cleared = lastCleared.get(repoRoot);
    if (!cleared?.length) return 0;
    const all = await readAll(repoRoot);
    all.push(...cleared);
    lastCleared.delete(repoRoot);
    await writeAll(repoRoot, all);
    return cleared.length;
  });
}
