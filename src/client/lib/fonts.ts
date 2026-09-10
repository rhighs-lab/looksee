export const PROSE_FONTS = ['charter', 'literata', 'sans'] as const;
export type ProseFont = (typeof PROSE_FONTS)[number];

export const CODE_FONTS = [
  'system',
  'source-code-pro',
  'jetbrains-mono',
] as const;
export type CodeFont = (typeof CODE_FONTS)[number];

export const PROSE_FONT_LABEL: Record<ProseFont, string> = {
  charter: 'Charter',
  literata: 'Literata',
  sans: 'UI sans',
};

export const CODE_FONT_LABEL: Record<CodeFont, string> = {
  system: 'System monospace',
  'source-code-pro': 'Source Code Pro',
  'jetbrains-mono': 'JetBrains Mono',
};

export const isProseFont = (v: unknown): v is ProseFont =>
  (PROSE_FONTS as readonly unknown[]).includes(v);
export const isCodeFont = (v: unknown): v is CodeFont =>
  (CODE_FONTS as readonly unknown[]).includes(v);

export function applyFonts(prose: ProseFont, code: CodeFont): void {
  const el = document.documentElement;
  el.dataset['proseFont'] = prose;
  el.dataset['codeFont'] = code;
}
