import { File, FileCode, FileMedia } from '@/client/components/icons.js';
import { fileIcon } from '@/client/lib/file-icon.js';

const GLYPHS = { code: FileCode, media: FileMedia, plain: File };

export function FileGlyph({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const { glyph, color } = fileIcon(path);
  const Glyph = GLYPHS[glyph];
  return <Glyph className={className} style={{ color }} />;
}
