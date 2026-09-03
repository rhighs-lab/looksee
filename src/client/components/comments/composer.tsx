import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api } from '@/client/api/client.js';
import { COMPOSER_ICONS } from '@/client/components/comments/icons.js';
import { Button } from '@/client/ui/index.js';
import type { CommentSide, SavedReply } from '@/shared/protocol.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl+';
const SHIFT = mac ? '⇧' : 'Shift+';

export interface ComposerAnchor {
  kind: 'line' | 'file' | 'reply';
  filePath?: string;
  side?: CommentSide;
  startLine?: number;
  endLine?: number;
  snapshot?: string[];
}

type Act =
  | 'suggestion'
  | 'heading'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'code'
  | 'link'
  | 'ul'
  | 'ol'
  | 'mention'
  | 'saved';

const TOOLS: Array<[Act | '|', string, string]> = [
  ['suggestion', 'Add a suggestion', ''],
  ['heading', 'Heading', ''],
  ['bold', 'Bold', `${MOD}B`],
  ['italic', 'Italic', `${MOD}I`],
  ['quote', 'Quote', `${MOD}${SHIFT}.`],
  ['code', 'Code', `${MOD}E`],
  ['link', 'Link', `${MOD}K`],
  ['|', '', ''],
  ['ul', 'Bulleted list', `${MOD}${SHIFT}8`],
  ['ol', 'Numbered list', `${MOD}${SHIFT}7`],
  ['|', '', ''],
  ['mention', 'Ask the agent', ''],
  ['saved', 'Saved replies', `${MOD}.`],
];

export function headerText(a: ComposerAnchor): string {
  if (a.kind === 'reply') return 'Reply';
  if (a.kind === 'file') return 'Add a comment on this file';
  const p = a.side === 'old' ? 'L' : 'R';
  const lo = a.startLine ?? 0;
  const hi = a.endLine ?? lo;
  return hi > lo
    ? `Add a comment on lines ${p}${lo} to ${p}${hi}`
    : `Add a comment on line ${p}${lo}`;
}

interface Edit {
  value: string;
  start: number;
  end: number;
}

const replaceSel = (
  ta: HTMLTextAreaElement,
  text: string,
  s: number,
  e: number
): Edit => {
  const { selectionStart, selectionEnd, value } = ta;
  return {
    value: value.slice(0, selectionStart) + text + value.slice(selectionEnd),
    start: s,
    end: e,
  };
};

const wrap = (
  ta: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string
): Edit => {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const inner = value.slice(s, e) || placeholder;
  return replaceSel(
    ta,
    before + inner + after,
    s + before.length,
    s + before.length + inner.length
  );
};

const prefixLines = (
  ta: HTMLTextAreaElement,
  prefix: string | ((i: number) => string)
): Edit => {
  const v = ta.value;
  let s = ta.selectionStart;
  let e = ta.selectionEnd;
  s = v.lastIndexOf('\n', s - 1) + 1;
  const nl = v.indexOf('\n', e);
  e = nl === -1 ? v.length : nl;
  const out = v
    .slice(s, e)
    .split('\n')
    .map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l)
    .join('\n');
  return {
    value: v.slice(0, s) + out + v.slice(e),
    start: s,
    end: s + out.length,
  };
};

const insertBlock = (ta: HTMLTextAreaElement, text: string): Edit => {
  const { selectionStart: s, value } = ta;
  const block = (s > 0 && value[s - 1] !== '\n' ? '\n' : '') + text;
  return {
    value: value.slice(0, s) + block + value.slice(ta.selectionEnd),
    start: s + block.length,
    end: s + block.length,
  };
};

const insertAt = (ta: HTMLTextAreaElement, text: string): Edit => {
  const { selectionStart: s, value } = ta;
  return {
    value: value.slice(0, s) + text + value.slice(s),
    start: s + text.length,
    end: s + text.length,
  };
};

const KEYS: Record<string, Act> = {
  b: 'bold',
  i: 'italic',
  e: 'code',
  k: 'link',
};
const SHIFT_CODES: Record<string, Act> = {
  Period: 'quote',
  Digit8: 'ul',
  Digit7: 'ol',
};
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });

export interface ComposerProps {
  anchor: ComposerAnchor;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  autoFocus?: boolean;
  submitLabel?: string;
}

export function Composer({
  anchor,
  onSubmit,
  onCancel,
  autoFocus = true,
  submitLabel,
}: ComposerProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<ReactNode>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<SavedReply[] | null>(null);
  const [dragover, setDragover] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each value change to restore the pending selection
  useEffect(() => {
    if (pendingSel.current && ta.current) {
      ta.current.setSelectionRange(
        pendingSel.current.start,
        pendingSel.current.end
      );
      ta.current.focus();
      pendingSel.current = null;
    }
  }, [value]);

  const applyEdit = (e: Edit) => {
    pendingSel.current = { start: e.start, end: e.end };
    setValue(e.value);
  };

  const suggestionBlock = () => {
    const lines = anchor.snapshot ?? [];
    return `\`\`\`suggestion\n${lines.join('\n')}${lines.length ? '\n' : ''}\`\`\`\n`;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: applyEdit, suggestionBlock and toggleSaved are recreated each render on purpose
  const run = useCallback(
    (act: Act) => {
      const el = ta.current;
      if (!el) return;
      if (tab === 'preview') setTab('write');
      switch (act) {
        case 'suggestion':
          return applyEdit(insertBlock(el, suggestionBlock()));
        case 'heading':
          return applyEdit(prefixLines(el, '### '));
        case 'bold':
          return applyEdit(wrap(el, '**', '**', 'bold text'));
        case 'italic':
          return applyEdit(wrap(el, '_', '_', 'italic text'));
        case 'quote':
          return applyEdit(prefixLines(el, '> '));
        case 'code': {
          const sel = el.value.slice(el.selectionStart, el.selectionEnd);
          return applyEdit(
            sel.includes('\n')
              ? wrap(el, '```\n', '\n```', '')
              : wrap(el, '`', '`', 'code')
          );
        }
        case 'link':
          return applyEdit(wrap(el, '[', '](url)', 'link text'));
        case 'ul':
          return applyEdit(prefixLines(el, '- '));
        case 'ol':
          return applyEdit(prefixLines(el, (i) => `${i + 1}. `));
        case 'mention':
          return applyEdit(wrap(el, '@agent ', '', ''));
        case 'saved':
          return void toggleSaved();
      }
    },
    [tab, anchor.snapshot]
  );

  const loadSaved = async (force = false) => {
    if (saved && !force) return saved;
    const { replies } = await api.savedReplies();
    setSaved(replies);
    return replies;
  };

  const toggleSaved = async () => {
    if (savedOpen) return setSavedOpen(false);
    setSavedOpen(true);
    try {
      await loadSaved();
    } catch {
      setNotice('Could not load saved replies');
    }
  };

  useEffect(() => {
    if (!savedOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!menuRef.current?.contains(t) && !t.closest('[data-act="saved"]'))
        setSavedOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    (
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]') ??
      menuRef.current
    )?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [savedOpen]);

  const pickSaved = (r: SavedReply) => {
    setSavedOpen(false);
    if (ta.current) applyEdit(insertAt(ta.current, r.body));
  };

  const deleteSaved = async (r: SavedReply) => {
    if (!confirm('Delete this saved reply?')) return;
    try {
      await api.deleteSavedReply(r.id);
      await loadSaved(true);
    } catch {
      setNotice('Could not delete saved reply');
    }
  };

  const saveCurrent = async () => {
    const body = value.trim();
    if (!body) return setNotice('Write the reply text first, then save it');
    const name = prompt('Name this saved reply');
    if (!name?.trim()) return;
    try {
      await api.addSavedReply(name.trim(), body);
      setNotice('');
      await loadSaved(true);
    } catch {
      setNotice('Could not save reply');
    }
  };

  const savedKeys = (e: KeyboardEvent) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setSavedOpen(false);
      ta.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      items[
        e.key === 'ArrowDown'
          ? (i + 1) % items.length
          : (i - 1 + items.length) % items.length
      ]?.focus();
    }
  };

  const showPreview = async () => {
    setTab('preview');
    setPreview(<span className="composer-muted">Loading preview</span>);
    try {
      const { html } = await api.preview({
        body: value,
        filePath: anchor.filePath ?? '',
        side: anchor.kind === 'line' ? anchor.side : anchor.kind,
        startLine: anchor.startLine ?? 0,
        endLine: anchor.endLine ?? anchor.startLine ?? 0,
      });
      setPreview(
        value.trim() ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="composer-muted">Nothing to preview</span>
        )
      );
    } catch (err) {
      setPreview(
        <span className="composer-error">
          Preview failed: {(err as Error).message}
        </span>
      );
    }
  };

  const upload = async (file: File) => {
    const el = ta.current;
    if (!el) return;
    const name = file.name || 'image';
    const placeholder = `![Uploading ${name}](#${Math.random().toString(36).slice(2, 8)})`;
    applyEdit(insertAt(el, placeholder));
    setNotice('');
    const swap = (text: string) =>
      setValue((v) => v.replace(placeholder, text));
    try {
      const data = await readBase64(file);
      const out = await api.upload(name, file.type, data);
      swap(`![${name}](${out.url})`);
    } catch (err) {
      swap('');
      setNotice(`Upload failed: ${(err as Error).message}`);
    }
  };

  const imageFiles = (list: FileList | undefined | null) =>
    [...(list ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(e.clipboardData?.files);
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => void upload(f));
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    setDragover(false);
    const files = imageFiles(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => void upload(f));
  };

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(value);
      setValue('');
    } catch (err) {
      setNotice(`Could not post: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return onCancel();
    }
    const cmd = mac ? e.metaKey : e.ctrlKey;
    if (!cmd) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      return void submit();
    }
    if (e.key === '.' && !e.shiftKey) {
      e.preventDefault();
      return void toggleSaved();
    }
    const act = e.shiftKey ? SHIFT_CODES[e.code] : KEYS[e.key.toLowerCase()];
    if (!act) return;
    e.preventDefault();
    run(act);
  };

  const canSuggest = anchor.kind === 'line' && anchor.side !== 'old';

  return (
    <form
      className="comment-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="composer-header">{headerText(anchor)}</div>
      <div className="composer-bar">
        <div className="composer-tabs" role="tablist">
          <button
            type="button"
            className={`composer-tab${tab === 'write' ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab === 'write'}
            onClick={() => setTab('write')}
          >
            Write
          </button>
          <button
            type="button"
            className={`composer-tab${tab === 'preview' ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab === 'preview'}
            onClick={() => void showPreview()}
          >
            Preview
          </button>
        </div>
        <div className="composer-tools">
          {TOOLS.filter(([act]) => act !== 'suggestion' || canSuggest).map(
            ([act, label, key], i) =>
              act === '|' ? (
                <span key={`sep${i}`} className="composer-sep" />
              ) : (
                <button
                  key={act}
                  type="button"
                  className="composer-tool"
                  data-act={act}
                  title={`${label}${key ? ` (${key})` : ''}`}
                  aria-label={label}
                  onClick={() => run(act)}
                >
                  {COMPOSER_ICONS[act]}
                </button>
              )
          )}
        </div>
        {savedOpen && (
          <div
            className="composer-saved-menu"
            role="menu"
            tabIndex={-1}
            ref={menuRef}
            onKeyDown={savedKeys}
          >
            {saved === null ? (
              <div className="composer-muted composer-saved-empty">Loading</div>
            ) : saved.length === 0 ? (
              <div className="composer-muted composer-saved-empty">
                No saved replies yet
              </div>
            ) : (
              saved.map((r) => (
                <div key={r.id} className="composer-saved-row">
                  <button
                    type="button"
                    className="composer-saved-item"
                    role="menuitem"
                    title={r.body}
                    onClick={() => pickSaved(r)}
                  >
                    {r.name}
                  </button>
                  <button
                    type="button"
                    className="composer-saved-del"
                    title="Delete saved reply"
                    aria-label={`Delete ${r.name}`}
                    onClick={() => void deleteSaved(r)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
            <button
              type="button"
              className="composer-saved-add"
              role="menuitem"
              onClick={() => void saveCurrent()}
            >
              Save current as reply
            </button>
          </div>
        )}
      </div>
      {notice && (
        <div className="composer-notice">
          <span className="composer-error">{notice}</span>
        </div>
      )}
      <textarea
        ref={ta}
        className={`comment-input${dragover ? ' is-dragover' : ''}`}
        rows={4}
        placeholder="Leave a comment"
        value={value}
        hidden={tab === 'preview'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return;
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
      />
      {tab === 'preview' && (
        <div className="comment-preview markdown-body">{preview}</div>
      )}
      <div className="comment-compose-actions">
        <span className="composer-hints">
          {MOD}B {MOD}I {MOD}E {MOD}K · {MOD}⏎ to comment · Paste or drop images
        </span>
        <Button className="comment-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !value.trim()}
        >
          {submitLabel ?? (anchor.kind === 'reply' ? 'Reply' : 'Comment')}
        </Button>
      </div>
    </form>
  );
}
