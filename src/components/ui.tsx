import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertCircle, Check, ChevronDown, Loader2, X } from 'lucide-react';
import { initials } from '../lib/format';
import type { Role } from '../../shared/domain';

export const cx = clsx;

// ============================ Button ============================

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type Size = 'xs' | 'sm' | 'md' | 'lg';
const btnVariant: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'bg-surface text-danger border border-line hover:bg-danger-bg hover:border-danger/30',
  dark: 'bg-ink text-white hover:bg-ink-2',
};
const btnSize: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1 rounded-sm',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-13 gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-100 select-none disabled:opacity-50 disabled:pointer-events-none',
        btnVariant[variant],
        btnSize[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink transition-colors disabled:opacity-40',
        size === 'sm' ? 'size-6' : 'size-8',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ============================ Form controls ============================

const control =
  'w-full rounded-md border border-line bg-surface text-13 text-ink placeholder:text-subtle outline-none transition-[border-color,box-shadow] hover:border-line-strong focus:border-brand focus:ring-3 focus:ring-brand/12 disabled:bg-hover disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(control, 'h-8 px-2.5', invalid && 'border-danger', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(control, 'px-2.5 py-2 leading-5 resize-y min-h-[72px]', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className={cx('relative', className)}>
      <select ref={ref} className={cx(control, 'h-8 appearance-none pl-2.5 pr-7 truncate')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
    </div>
  );
});

export function Field({ label, hint, error, children, className, htmlFor, optional }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
          {label} {optional && <span className="font-normal text-subtle">· optional</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex items-start gap-2.5 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <span className="relative mt-0.5 flex">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="size-4 rounded-sm border border-line-strong bg-surface peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/30 transition-colors" />
        <Check className="absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      <span className="flex flex-col">
        <span className="text-13 text-ink">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Segmented control — used for explicit choices such as visibility. */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-hover p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-xs',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================ Display ============================

export type Tone = 'neutral' | 'muted' | 'brand' | 'brandSolid' | 'dark' | 'warning' | 'danger' | 'success' | 'outline';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-hover text-ink-2',
  muted: 'bg-transparent text-muted border border-line',
  brand: 'bg-brand-50 text-brand',
  brandSolid: 'bg-brand text-white',
  dark: 'bg-ink text-white',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
  outline: 'border border-line-strong text-ink-2',
};
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-medium whitespace-nowrap', toneCls[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Avatar({ name, role, size = 28, className }: { name?: string | null; role?: Role | string | null; size?: number; className?: string }) {
  const client = role === 'client' || role === 'client_collaborator';
  return (
    <span
      title={name ?? undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight select-none',
        client ? 'bg-brand-50 text-brand ring-1 ring-brand-100' : 'bg-ink text-white',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initials(name)}
    </span>
  );
}

export function ProgressBar({ value, className, size = 'sm', tone = 'brand' }: { value: number; className?: string; size?: 'xs' | 'sm' | 'md'; tone?: 'brand' | 'ink' }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('w-full overflow-hidden rounded-full bg-line', size === 'xs' ? 'h-1' : size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div className={cx('h-full rounded-full transition-[width] duration-500', tone === 'brand' ? 'bg-brand' : 'bg-ink')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-hover', className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'py-6 px-4' : 'py-14 px-6', className)}>
      {icon && <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-muted [&>svg]:size-4">{icon}</div>}
      <p className="text-13 font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-13 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertCircle />}
      title="We couldn’t load this"
      description={(error as Error)?.message ?? 'Please try again.'}
      action={onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Panel({ title, actions, children, className, bodyClassName, description }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 min-h-12">
          <div className="min-w-0">
            {title && <h2 className="text-13 font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx(bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-[20px] leading-7 font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 text-13 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-5 border-b border-line overflow-x-auto scrollbar-thin', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 text-13 font-medium transition-colors',
            value === t.value ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cx('rounded-sm px-1 text-2xs tabular', value === t.value ? 'bg-brand-50 text-brand' : 'bg-hover text-muted')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-2xs font-medium text-white opacity-0 transition-opacity delay-200 group-hover/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line bg-surface px-1 text-2xs text-muted">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} />;
}

// ============================ Overlays ============================

function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, active]);
}

function useBodyLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  useEscape(onClose, open);
  useBodyLock(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/25 animate-fade-in" onClick={onClose} />
      <div
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-xl bg-surface shadow-pop animate-pop-in sm:rounded-xl',
          size === 'sm' ? 'sm:max-w-sm' : size === 'md' ? 'sm:max-w-lg' : 'sm:max-w-2xl',
        )}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-13 text-muted">{description}</p>}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1">
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 pb-5 scrollbar-thin">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 560, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string }) {
  useEscape(onClose, open);
  useBodyLock(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-ink/15 animate-fade-in" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-pop animate-slide-in sm:border-l sm:border-line" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({ trigger, children, align = 'right', className }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEscape(() => setOpen(false), open);
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-40 mt-1 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-pop animate-pop-in',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, icon, danger, disabled }: { children: ReactNode; onClick: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-13 transition-colors disabled:opacity-40 [&>svg]:size-3.5',
        danger ? 'text-danger hover:bg-danger-bg' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ============================ Toasts ============================

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: ReactNode;
}
const ToastCtx = createContext<(kind: Toast['kind'], message: ReactNode) => void>(() => {});
export const useToast = () => {
  const push = useContext(ToastCtx);
  return {
    success: (m: ReactNode) => push('success', m),
    error: (m: ReactNode | Error) => push('error', m instanceof Error ? m.message : m),
    info: (m: ReactNode) => push('info', m),
  };
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], message: ReactNode) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:right-6 sm:left-auto" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg bg-ink px-3.5 py-2.5 text-13 text-white shadow-pop animate-pop-in">
              {t.kind === 'success' ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-white" strokeWidth={3} />
              ) : t.kind === 'error' ? (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[#ff8a8a]" />
              ) : (
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-200" />
              )}
              <span>{t.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ============================ Confirm dialog ============================

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {state?.description && <p className="text-13 text-muted">{state.description}</p>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ============================ Misc ============================

export function Divider({ className }: { className?: string }) {
  return <hr className={cx('border-line', className)} />;
}

export function Stat({ label, value, hint, icon, emphasis }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={cx('rounded-lg border bg-surface px-4 py-3.5', emphasis ? 'border-brand/30' : 'border-line')}>
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        {icon && <span className={cx('[&>svg]:size-3.5', emphasis ? 'text-brand' : 'text-subtle')}>{icon}</span>}
      </div>
      <div className={cx('mt-2 text-[22px] leading-7 font-semibold tabular tracking-tight', emphasis ? 'text-brand' : 'text-ink')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function KeyValue({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2.5 text-13', className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{it.label}</dt>
          <dd className="min-w-0 text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
