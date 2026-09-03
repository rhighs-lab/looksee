import type {
  ButtonHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
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
    SelectHTMLAttributes<HTMLSelectElement>,
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
  ...rest
}: SelectProps) {
  const groups = new Map<string, SelectOption[]>();
  for (const o of options) {
    const g = o.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }
  const render = (list: SelectOption[]) =>
    list.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label ?? o.value}
      </option>
    ));
  return (
    <label className="ui-select" title={title}>
      {prefix && <span className="ui-select-prefix">{prefix}</span>}
      <select
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      >
        {[...groups.entries()].map(([g, list]) =>
          g ? (
            <optgroup key={g} label={g}>
              {render(list)}
            </optgroup>
          ) : (
            render(list)
          )
        )}
      </select>
    </label>
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
