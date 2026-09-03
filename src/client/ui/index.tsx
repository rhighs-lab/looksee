import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from '@/client/components/icons.js';
import { useReview } from '@/client/store/review.js';

export type Tone =
  | 'success'
  | 'danger'
  | 'accent'
  | 'attention'
  | 'done'
  | 'muted';

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'invisible'
  | 'danger'
  | 'link';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  icon?: boolean;
}

export function Button({
  variant = 'default',
  small = false,
  icon = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ui-btn',
        variant !== 'default' && `ui-btn-${variant}`,
        small && 'ui-btn-small',
        icon && 'ui-btn-icon',
        className
      )}
      {...rest}
    />
  );
}

export function LinkButton({
  href,
  children,
  className,
  title,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a
      className={cx('ui-btn ui-btn-small', className)}
      href={href}
      title={title}
    >
      {children}
    </a>
  );
}

export interface SegmentedItem<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="ui-segmented" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className="ui-segmented-item"
          aria-pressed={it.value === value}
          title={it.title}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </span>
  );
}

export interface NavItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  title?: string;
  disabled?: boolean;
}

export function UnderlineNav<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: NavItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <nav className="ui-nav" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className="ui-nav-item"
          aria-current={it.value === value}
          title={it.title}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count !== undefined && <Counter n={it.count} />}
        </button>
      ))}
    </nav>
  );
}

export function Counter({ n }: { n: number }) {
  return <span className="ui-counter">{n}</span>;
}

export function Label({
  tone = 'muted',
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('ui-label', `ui-label-${tone}`, className)}
      title={title}
    >
      {children}
    </span>
  );
}

export function StatusLetter({
  letter,
  tone,
  label,
  title,
}: {
  letter: string;
  tone: Tone;
  label: string;
  title?: string;
}) {
  return (
    <span
      className={cx('ui-status', `ui-status-${tone}`)}
      title={title ?? label}
      aria-label={label}
      role="img"
    >
      {letter}
    </span>
  );
}

export function StatusGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span className="ui-status-group" role="group" aria-label={label}>
      {children}
    </span>
  );
}

export interface SelectOption {
  value: string;
  label?: string;
  group?: string;
}

export interface SelectProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onChange' | 'value' | 'prefix'
  > {
  prefix?: ReactNode;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function Select({
  prefix,
  value,
  options,
  onChange,
  title,
  className,
  ...rest
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    );
    list.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.focus();
  }, [open, active]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const pick = (v: string) => {
    close();
    if (v !== value) onChange(v);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    if (e.key === 'Escape' || e.key === 'Tab') return close();
    if (e.key === 'ArrowDown') setActive((i) => Math.min(n - 1, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const o = options[active];
      if (o) pick(o.value);
    } else return;
    e.preventDefault();
  };

  const groups = new Map<string, Array<[SelectOption, number]>>();
  options.forEach((o, i) => {
    const g = o.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), [o, i]]);
  });

  return (
    <div className={cx('ui-select', open && 'is-open', className)} ref={root}>
      <button
        type="button"
        className="ui-select-btn"
        ref={btn}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          setOpen(true);
        }}
        {...rest}
      >
        {prefix && <span className="ui-select-prefix">{prefix}</span>}
        <span className="ui-select-value">{cur?.label ?? value}</span>
        <ChevronDown className="ui-select-caret" width={12} height={12} />
      </button>
      {open && (
        <div className="ui-select-menu" role="listbox" ref={list}>
          {[...groups.entries()].map(([g, list]) => (
            <Fragment key={g || '_'}>
              {g && <div className="ui-select-group">{g}</div>}
              {list.map(([o, i]) => (
                <div
                  key={o.value}
                  role="option"
                  tabIndex={-1}
                  aria-selected={o.value === value}
                  data-idx={i}
                  className={cx(
                    'ui-select-option',
                    i === active && 'is-active'
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  onKeyDown={onKey}
                >
                  <span className="ui-select-check">
                    {o.value === value && <Check />}
                  </span>
                  <span className="ui-select-label">{o.label ?? o.value}</span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export function Notice({
  tone = 'accent',
  children,
}: {
  tone?: 'accent' | 'danger' | 'attention' | 'muted';
  children: ReactNode;
}) {
  return (
    <div
      className={cx('ui-notice', tone !== 'accent' && `ui-notice-${tone}`)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function Toast() {
  const toast = useReview((s) => s.toast);
  const hide = useReview((s) => s.hideToast);
  if (!toast) return null;
  return (
    <div className="ui-toast" role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <Button
          small
          onClick={() => {
            hide();
            toast.action?.fn();
          }}
        >
          {toast.action.label}
        </Button>
      )}
    </div>
  );
}
