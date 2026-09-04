import { useEffect, useRef, useState } from 'react';
import { Check, Gear } from '@/client/components/icons.js';
import { APPEARANCES, THEME_LABEL, THEMES } from '@/client/lib/theme.js';
import type { Appearance, Theme } from '@/client/store/prefs.js';
import { useReview } from '@/client/store/review.js';
import { Button } from '@/client/ui/index.js';

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
              <Swatch theme={t} mode={mode} />
              {THEME_LABEL[t]}
            </Row>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">Appearance</div>
          {APPEARANCES.map((a) => (
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
