import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageRoot(from = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(from));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('looksee package root not found');
}
