import { useEffect, useRef, useState } from 'react';
import { Check, Gear } from '@/client/components/icons.js';
import {
  CODE_FONT_LABEL,
  CODE_FONTS,
  PROSE_FONT_LABEL,
  PROSE_FONTS,
} from '@/client/lib/fonts.js';
import {
  APPEARANCES,
  isDarkOnly,
  THEME_LABEL,
  THEMES,
} from '@/client/lib/theme.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';
import type { Appearance, Theme } from '@/shared/protocol.js';

const APPEARANCE_LABEL: Record<Appearance, string> = {
  auto: 'System',
  light: 'Light',
  dark: 'Dark',
};

const SWATCHES: Record<Theme, Record<'light' | 'dark', string[]>> = {
  github: {
    light: ['#ffffff', '#1f883d', '#cf222e', '#0969da'],
    dark: ['#0d1117', '#3fb950', '#f85149', '#58a6ff'],
  },
  solarized: {
    light: ['#fdf6e3', '#4f8f00', '#dc322f', '#268bd2'],
    dark: ['#002b36', '#859900', '#dc322f', '#268bd2'],
  },
  atom: {
    light: ['#fafafa', '#50a14f', '#e45649', '#4078f2'],
    dark: ['#282c34', '#98c379', '#e06c75', '#61afef'],
  },
  darkened: {
    light: ['#000000', '#9cda7c', '#db6088', '#b968fc'],
    dark: ['#000000', '#9cda7c', '#db6088', '#b968fc'],
  },
  dracula: {
    light: ['#282a36', '#50fa7b', '#ff5555', '#bd93f9'],
    dark: ['#282a36', '#50fa7b', '#ff5555', '#bd93f9'],
  },
  nord: {
    light: ['#2e3440', '#a3be8c', '#bf616a', '#88c0d0'],
    dark: ['#2e3440', '#a3be8c', '#bf616a', '#88c0d0'],
  },
  tokyo: {
    light: ['#1a1b26', '#9ece6a', '#f7768e', '#7aa2f7'],
    dark: ['#1a1b26', '#9ece6a', '#f7768e', '#7aa2f7'],
  },
  catppuccin: {
    light: ['#eff1f5', '#40a02b', '#d20f39', '#1e66f5'],
    dark: ['#1e1e2e', '#a6e3a1', '#f38ba8', '#89b4fa'],
  },
  everforest: {
    light: ['#fdf6e3', '#8da101', '#f85552', '#3a94c5'],
    dark: ['#2d353b', '#a7c080', '#e67e80', '#7fbbb3'],
  },
};

function Swatch({ theme, mode }: { theme: Theme; mode: 'light' | 'dark' }) {
  return (
    <span className="theme-swatch" aria-hidden="true">
      {SWATCHES[theme][mode].map((c) => (
        <span key={c} style={{ backgroundColor: c }} />
      ))}
    </span>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
    >
      <span className="menu-check">{active && <Check />}</span>
      {children}
    </button>
  );
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const theme = useReview((s) => s.theme);
  const appearance = useReview((s) => s.appearance);
  const setTheme = useReview((s) => s.setTheme);
  const setAppearance = useReview((s) => s.setAppearance);
  const view = useReview((s) => s.view);
  const setView = useReview((s) => s.setView);
  const colorByLayer = useReview((s) => s.colorByLayer);
  const setColorByLayer = useReview((s) => s.setColorByLayer);
  const treeHidden = useReview((s) => s.treeHidden);
  const setTreeHidden = useReview((s) => s.setTreeHidden);
  const newLineAttention = useReview((s) => s.newLineAttention);
  const setNewLineAttention = useReview((s) => s.setNewLineAttention);
  const proseFont = useReview((s) => s.proseFont);
  const setProseFont = useReview((s) => s.setProseFont);
  const codeFont = useReview((s) => s.codeFont);
  const setCodeFont = useReview((s) => s.setCodeFont);
  const isRepo = useReview((s) => Boolean(s.state?.repoRoot));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const mode: 'light' | 'dark' =
    (document.documentElement.dataset['mode'] as 'light' | 'dark') ?? 'light';

  return (
    <div className="settings" ref={ref}>
      <Button
        small
        icon
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <Gear width={14} height={14} />
      </Button>
      {open && (
        <div className="menu" role="menu" aria-label="Settings">
          <div className="menu-label">Theme</div>
          {THEMES.map((t) => (
            <Row key={t} active={t === theme} onClick={() => setTheme(t)}>
              <Swatch theme={t} mode={isDarkOnly(t) ? 'dark' : mode} />
              {THEME_LABEL[t]}
            </Row>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">
            Appearance
            {isDarkOnly(theme) && (
              <span className="ui-muted">
                {' '}
                · {THEME_LABEL[theme]} is dark only
              </span>
            )}
          </div>
          {!isDarkOnly(theme) &&
            APPEARANCES.map((a) => (
              <Row
                key={a}
                active={a === appearance}
                onClick={() => setAppearance(a)}
              >
                {APPEARANCE_LABEL[a]}
              </Row>
            ))}
          <div className="menu-sep" />
          <div className="menu-label">Diff</div>
          <Row
            active={view === 'split'}
            onClick={() => setView(view === 'split' ? 'unified' : 'split')}
          >
            Split view
          </Row>
          {isRepo && (
            <Row
              active={colorByLayer}
              onClick={() => void setColorByLayer(!colorByLayer)}
            >
              Layer colors
            </Row>
          )}
          <Row active={!treeHidden} onClick={() => setTreeHidden(!treeHidden)}>
            File tree
          </Row>
          <div className="menu-sep" />
          <div className="menu-label">Prose font</div>
          {PROSE_FONTS.map((f) => (
            <Row
              key={f}
              active={f === proseFont}
              onClick={() => setProseFont(f)}
            >
              {PROSE_FONT_LABEL[f]}
            </Row>
          ))}
          <div className="menu-label">Code font</div>
          {CODE_FONTS.map((f) => (
            <Row key={f} active={f === codeFont} onClick={() => setCodeFont(f)}>
              {CODE_FONT_LABEL[f]}
            </Row>
          ))}
          <div className="font-preview" aria-hidden="true">
            <p className="font-preview-prose">
              Review prose reads like writing, with <code>inline code</code> set
              in the code font.
            </p>
            <pre className="font-preview-code">
              {
                'const total = items.reduce((n, i) => n + i, 0);\nreturn `${total} of ${items.length}`;'
              }
            </pre>
          </div>
          <div className="menu-sep" />
          <div className="menu-label">Experimental</div>
          <Row
            active={newLineAttention}
            onClick={() => setNewLineAttention(!newLineAttention)}
          >
            Mark arriving lines
          </Row>
        </div>
      )}
    </div>
  );
}
