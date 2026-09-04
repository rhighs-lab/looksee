export type FileGlyph = 'code' | 'media' | 'plain';

interface Kind {
  glyph: FileGlyph;
  color: string;
}

const CODE = (color: string): Kind => ({ glyph: 'code', color });
const PLAIN = (color: string): Kind => ({ glyph: 'plain', color });
const MEDIA = (color: string): Kind => ({ glyph: 'media', color });

const BY_EXT: Record<string, Kind> = {
  ts: CODE('#3178c6'),
  tsx: CODE('#3178c6'),
  mts: CODE('#3178c6'),
  cts: CODE('#3178c6'),
  js: CODE('#f1e05a'),
  jsx: CODE('#f1e05a'),
  mjs: CODE('#f1e05a'),
  cjs: CODE('#f1e05a'),
  json: PLAIN('#f1e05a'),
  css: CODE('#663399'),
  scss: CODE('#c6538c'),
  html: CODE('#e34c26'),
  md: PLAIN('#519aba'),
  mdx: PLAIN('#519aba'),
  yml: PLAIN('#cb171e'),
  yaml: PLAIN('#cb171e'),
  toml: PLAIN('#9c4221'),
  sh: CODE('#89e051'),
  bash: CODE('#89e051'),
  zsh: CODE('#89e051'),
  py: CODE('#3572a5'),
  rs: CODE('#dea584'),
  go: CODE('#00add8'),
  rb: CODE('#701516'),
  java: CODE('#b07219'),
  c: CODE('#555555'),
  h: CODE('#555555'),
  cpp: CODE('#f34b7d'),
  hpp: CODE('#f34b7d'),
  cc: CODE('#f34b7d'),
  swift: CODE('#f05138'),
  kt: CODE('#a97bff'),
  php: CODE('#4f5d95'),
  sql: CODE('#e38c00'),
  svg: MEDIA('#ff9a00'),
  png: MEDIA('#a074c4'),
  jpg: MEDIA('#a074c4'),
  jpeg: MEDIA('#a074c4'),
  gif: MEDIA('#a074c4'),
  webp: MEDIA('#a074c4'),
  avif: MEDIA('#a074c4'),
  ico: MEDIA('#a074c4'),
  woff: MEDIA('#cc6d2e'),
  woff2: MEDIA('#cc6d2e'),
  ttf: MEDIA('#cc6d2e'),
  pdf: PLAIN('#d1242f'),
  lock: PLAIN('#8b949e'),
  txt: PLAIN('#8b949e'),
};

const BY_NAME: Record<string, Kind> = {
  'package.json': PLAIN('#89e051'),
  'pnpm-lock.yaml': PLAIN('#8b949e'),
  'package-lock.json': PLAIN('#8b949e'),
  dockerfile: CODE('#384d54'),
  makefile: CODE('#427819'),
  license: PLAIN('#d4a72c'),
  '.gitignore': PLAIN('#8b949e'),
  '.env': PLAIN('#d4a72c'),
};

const DEFAULT: Kind = { glyph: 'plain', color: '#8b949e' };

export function fileIcon(filePath: string): Kind {
  const name = (filePath.split('/').pop() ?? '').toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  return BY_EXT[ext] ?? DEFAULT;
}
