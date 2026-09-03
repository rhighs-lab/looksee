import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
export const ATTACHMENT_NAME = /^[a-f0-9]{16,}\.(png|jpe?g|gif|webp)$/;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export function matchesMagic(buf: Buffer, type: string): boolean {
  const startsWith = (bytes: number[], at = 0) =>
    bytes.every((b, i) => buf[at + i] === b);
  switch (type) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/gif':
      return buf.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      return (
        buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    default:
      return false;
  }
}

export const attachmentsDir = (repoRoot: string) =>
  path.join(repoRoot, '.looksee', 'attachments');

export async function ensureExcluded(repoRoot: string): Promise<void> {
  try {
    const p = path.join(repoRoot, '.git', 'info', 'exclude');
    let cur = '';
    try {
      cur = await fs.readFile(p, 'utf8');
    } catch {
      /* may not exist */
    }
    if (cur.split('\n').some((l) => l.trim() === '.looksee/')) return;
    const prefix = cur && !cur.endsWith('\n') ? `${cur}\n` : cur;
    await fs.writeFile(p, `${prefix}.looksee/\n`);
  } catch {
    /* .git may be a file or unwritable */
  }
}

export async function saveAttachment(
  repoRoot: string,
  type: string,
  data: string
): Promise<{ file: string; url: string; path: string } | { error: string }> {
  const ext = IMAGE_EXT[type];
  if (!ext) return { error: 'unsupported type' };
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || !matchesMagic(buf, type))
    return { error: 'bad image data' };
  const file = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await fs.mkdir(attachmentsDir(repoRoot), { recursive: true });
  await fs.writeFile(path.join(attachmentsDir(repoRoot), file), buf);
  await ensureExcluded(repoRoot);
  return {
    file,
    url: `/attachments/${file}`,
    path: path.posix.join('.looksee', 'attachments', file),
  };
}
