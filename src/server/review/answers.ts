import crypto from 'node:crypto';
import path from 'node:path';
import { safeRelPath } from '@/server/git/paths.js';
import {
  lookseeHome,
  readJsonArray,
  repoKey,
  withLock,
  writeJsonAtomic,
} from '@/server/review/store.js';
import type { Answer, AnswerHit } from '@/shared/protocol.js';

const MAX_KEPT = 50;

const file = (repoRoot: string): string =>
  path.join(lookseeHome(), `${repoKey(repoRoot)}-answers.json`);

const readAll = (repoRoot: string) =>
  readJsonArray<Answer>(file(repoRoot), 'answers');

const locked = <T>(repoRoot: string, fn: () => Promise<T>) =>
  withLock(`answers:${repoRoot}`, fn);

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const lineOf = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function parseHits(v: unknown): AnswerHit[] {
  if (!Array.isArray(v)) return [];
  const out: AnswerHit[] = [];
  for (const raw of v.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as Record<string, unknown>;
    const p = safeRelPath(h['path']);
    if (!p) continue;
    const startLine = lineOf(h['startLine']);
    if (!startLine) continue;
    const endLine = Math.max(startLine, lineOf(h['endLine']) || startLine);
    out.push({
      path: p,
      startLine,
      endLine,
      symbol: str(h['symbol'], 120),
      role: str(h['role'], 60),
      why: str(h['why'], 600),
      group: str(h['group'], 40),
    });
  }
  return out;
}

export async function listAnswers(repoRoot: string): Promise<Answer[]> {
  const all = await readAll(repoRoot);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAnswer(
  repoRoot: string,
  id: string
): Promise<Answer | null> {
  return (await readAll(repoRoot)).find((a) => a.id === id) ?? null;
}

export function saveAnswer(
  repoRoot: string,
  input: {
    question: string;
    summary: string;
    author: string;
    hits: AnswerHit[];
  }
): Promise<Answer> {
  return locked(repoRoot, async () => {
    const answer: Answer = {
      id: crypto.randomUUID(),
      repoRoot,
      question: input.question,
      summary: input.summary,
      author: input.author,
      hits: input.hits,
      createdAt: new Date().toISOString(),
    };
    const all = [answer, ...(await readAll(repoRoot))].slice(0, MAX_KEPT);
    await writeJsonAtomic(file(repoRoot), { answers: all });
    return answer;
  });
}

export function deleteAnswer(repoRoot: string, id: string): Promise<boolean> {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    const kept = all.filter((a) => a.id !== id);
    if (kept.length === all.length) return false;
    await writeJsonAtomic(file(repoRoot), { answers: kept });
    return true;
  });
}
