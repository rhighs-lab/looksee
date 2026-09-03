import crypto from 'node:crypto';
import path from 'node:path';
import {
  lookseeHome,
  readJsonArray,
  withLock,
  writeJsonAtomic,
} from '@/server/review/store.js';
import type { SavedReply } from '@/shared/protocol.js';

const file = () => path.join(lookseeHome(), 'saved-replies.json');
const readAll = () => readJsonArray<SavedReply>(file(), 'replies');
const locked = <T>(fn: () => Promise<T>) => withLock('saved-replies', fn);

export const listSavedReplies = (): Promise<SavedReply[]> => readAll();

export function addSavedReply(input: {
  name: string;
  body: string;
}): Promise<SavedReply> {
  return locked(async () => {
    const all = await readAll();
    const reply: SavedReply = {
      id: crypto.randomUUID(),
      name: input.name,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    all.push(reply);
    await writeJsonAtomic(file(), { replies: all });
    return reply;
  });
}

export function deleteSavedReply(id: string): Promise<boolean> {
  return locked(async () => {
    const all = await readAll();
    const kept = all.filter((r) => r.id !== id);
    if (kept.length === all.length) return false;
    await writeJsonAtomic(file(), { replies: kept });
    return true;
  });
}
