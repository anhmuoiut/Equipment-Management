'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, RotateCcw, TriangleAlert, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Button({
  children, variant = 'quiet', size = 'md', loading, disabled, ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  /** Shows a spinner in place of nothing and disables the button — the one
   *  loading treatment every async action button in the app should use, so
   *  a click can never be a silent no-op and a second click can never fire
   *  a duplicate request while the first is still in flight. */
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]';
  // Explicit per-variant hover/pressed state (CSS .ui-button--primary /
  // --danger / --quiet) instead of one global darken for every button.
  const stateClass =
    variant === 'primary' ? 'ui-button--primary'
      : variant === 'danger' ? 'ui-button--danger'
        : 'ui-button--quiet';

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={rest.style}
      className={`ui-button ui-button--${size} ${stateClass} border font-medium disabled:opacity-40 ${pad} ${rest.className ?? ''}`}
    >
      {loading && <Loader2 size={size === 'sm' ? 13 : 15} aria-hidden="true" className="ui-spin" />}
      {variant === 'danger' && !loading && <TriangleAlert size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Notice({
  tone, children, onDismiss, dismissLabel,
}: { tone: 'warn' | 'alert' | 'info'; children: ReactNode; onDismiss?: () => void; dismissLabel?: string }) {
  const { t } = useTranslation();
  const c =
    tone === 'alert'
      ? { borderColor: 'var(--alert)', background: 'var(--alert-tint)', color: 'var(--alert)' }
      : tone === 'warn'
        ? { borderColor: 'var(--warn)', background: 'var(--warn-tint)', color: 'var(--warn)' }
        : { borderColor: 'var(--machine)', background: 'var(--machine-tint)', color: 'var(--ok)' };
  return (
    <div className="ui-notice flex items-start gap-3 border-l-2 py-2 pl-3 pr-2 text-[13px]" data-tone={tone} role={tone === 'alert' ? 'alert' : 'status'} style={c}>
      {tone === 'info' ? <Info size={18} className="shrink-0" aria-hidden="true" /> : <TriangleAlert size={18} className="shrink-0" aria-hidden="true" />}
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-[11px] underline" style={{ color: 'inherit' }}>
          {dismissLabel ?? t('common.close')}
        </button>
      )}
    </div>
  );
}

/** Open dialogs, oldest first — Escape and Tab only act on the newest (a picker sheet over a dialog). */
const openModals: object[] = [];

/** Cỡ cố định theo màn hình mở đầu (docs/DETAIL_MODEL.md 3.1): S ~440px, M ~640px, L ~960px; dưới 768px luôn toàn màn hình. */
export type ModalSize = 's' | 'm' | 'l';

type ModalContextValue = { footerEl: HTMLElement | null; size: ModalSize };
const ModalContext = createContext<ModalContextValue | null>(null);
/** Màn hình đang bị che (ví dụ "Hủy bỏ thay đổi?" đang hiện trên form): nút footer của nó tạm ngừng hiện. */
const SuspendedContext = createContext(false);

export function ModalSuspend({ suspended, children }: { suspended: boolean; children: ReactNode }) {
  return <SuspendedContext.Provider value={suspended}>{children}</SuspendedContext.Provider>;
}

/**
 * Nút ở footer của Modal gần nhất, viết ngay cạnh màn hình sở hữu chúng (trạng thái đang gửi, đang chạy thử…)
 * thay vì phải đẩy lên khung. Không làm gì ngoài Modal hoặc khi màn hình đang bị che.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  const ctx = useContext(ModalContext);
  const suspended = useContext(SuspendedContext);
  if (!ctx?.footerEl || suspended) return null;
  return createPortal(children, ctx.footerEl);
}

let pageLocks = 0;
/** Modal mở: nền không cuộn và không nhận focus / bấm (inert); modal cuối cùng đóng thì trả lại. */
function lockPage() {
  if (pageLocks++ > 0) return;
  document.body.style.overflow = 'hidden';
  document.querySelector('.app-shell')?.setAttribute('inert', '');
}
function unlockPage() {
  if (--pageLocks > 0) return;
  pageLocks = 0;
  document.body.style.overflow = '';
  document.querySelector('.app-shell')?.removeAttribute('inert');
}

/**
 * Hộp thoại — mount khi mở, unmount khi đóng (trả focus về chỗ cũ). Vẽ ra `document.body`.
 * `header` thay tiêu đề mặc định (RecordModal: ‹ ›, breadcrumb, tag); `tabs` đứng cố định dưới header;
 * `busy`: đang gửi — không đóng được.
 */
export function Modal({
  title, onClose, children, size = 's', sheet, footer, header, tabs, busy, ariaLabel, className, headerAction,
}: {
  title: string; onClose: () => void; children: ReactNode;
  size?: ModalSize;
  /** Phones: slides up from the bottom as a sheet (filters); elsewhere the same centred dialog. */
  sheet?: boolean;
  /** Action buttons pinned below the scrolling body — so Save/Cancel stay
   *  reachable on a long form instead of scrolling away with the content.
   *  Without it, screens place their buttons with <ModalFooter>. */
  footer?: ReactNode;
  header?: ReactNode;
  tabs?: ReactNode;
  busy?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Optional header action, e.g. Reset in a filter sheet; Cancel/backdrop still close it. */
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  // Callers pass an inline `onClose`, a fresh function identity on every
  // render (e.g. every keystroke in a field this modal contains). Reading
  // it through a ref updated on every render — instead of depending on it
  // directly — keeps the effect below from treating "the caller re-rendered"
  // as "something about the modal changed" and re-grabbing focus mid-type.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const requestClose = () => { if (!busyRef.current) onCloseRef.current(); };
  // A press that starts inside the dialog (selecting text in a field) and is released over the backdrop
  // still produces a click on the backdrop — that must not close the dialog and throw the form away.
  const pressStartedInside = useRef(false);

  // document.body chỉ có ở trình duyệt: vẽ sau lần render đầu (server và lần đầu của client giống nhau).
  useEffect(() => { setHost(document.body); }, []);

  useEffect(() => {
    if (!host) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const self = {};
    openModals.push(self);
    lockPage();
    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== self) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      } else if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        )).filter((element) => element.getClientRects().length > 0);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(self), 1);
      unlockPage();
      previousFocus?.focus();
    };
    // Chạy một lần khi mở — onClose / busy đọc qua ref ở trên.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const context = useMemo<ModalContextValue>(() => ({ footerEl, size }), [footerEl, size]);
  if (!host) return null;

  return createPortal(
    <ModalContext.Provider value={context}>
      <div className={`modal-overlay${sheet ? ' modal-overlay--sheet' : ''}`}
           data-action-dialog="true"
           style={{ background: 'var(--overlay)' }}
           onMouseDown={(e) => { pressStartedInside.current = e.target !== e.currentTarget; }}
           onClick={(e) => { e.stopPropagation(); if (!pressStartedInside.current) requestClose(); pressStartedInside.current = false; }}>
        <div
          ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}
          onClick={(e) => e.stopPropagation()}
          className={`modal-dialog modal-dialog--${sheet ? 'sheet' : size}${className ? ` ${className}` : ''}`} data-size={size}
          style={{ background: 'var(--panel)', borderColor: 'var(--rule)', color: 'var(--ink)' }}
        >
          {sheet && <div className="modal-sheet-handle" aria-hidden="true" />}
          <div className="modal-header">
            <div className="modal-header-main">{header ?? <h2>{title}</h2>}</div>
            {headerAction ?? <button type="button" className="modal-close" onClick={requestClose} disabled={busy} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button>}
          </div>
          {tabs}
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-footer">{footer}</div> : <div className="modal-footer" ref={setFooterEl} />}
        </div>
      </div>
    </ModalContext.Provider>,
    host,
  );
}

/** The one rotating loading indicator in the app — `size` picks how loud it
 *  reads: 'sm' inline next to a short status line, 'md' filling a table/
 *  panel body, 'lg' for a full-page initial load. Continuous rotation via
 *  the shared `.ui-spin` keyframe (also used by Button's loading state),
 *  which the app-wide `prefers-reduced-motion` rule in globals.css already
 *  flattens to near-instant — no extra work needed here for that. */
export function Spinner({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 32 : 22;
  const pad = size === 'lg' ? 'py-16' : size === 'sm' ? 'py-2' : 'py-8';
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${pad}`} role="status" aria-live="polite">
      <Loader2 size={px} aria-hidden="true" className="ui-spin" style={{ color: 'var(--machine)' }} />
      <span className="text-[13px]" style={{ color: 'var(--ink-3)' }}>{label}</span>
    </div>
  );
}

/** A single placeholder block — compose a few into a shape that roughly
 *  matches the real content (a KPI card, a table row) so nothing jumps
 *  when the real content swaps in. Shimmer respects prefers-reduced-motion
 *  via the same global rule as everything else animated in this app. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`ui-skeleton ${className ?? ''}`} style={style} aria-hidden="true" />;
}

/** N skeleton rows matching a table's real column count — for re-fetches
 *  (search/filter/sort/page) where the table shouldn't collapse to a bare
 *  spinner and lose its shape. Only for genuinely empty-so-far tables; a
 *  table that already has rows should just keep showing them while a
 *  background refetch runs (Masterlist: `loading && rows.length === 0`). */
export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}><Skeleton className="h-4" style={{ width: c === 0 ? '60%' : '85%' }} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Covers just its positioned parent (not the whole viewport) while a
 *  must-not-be-interrupted operation runs — an action screen's confirm
 *  (Swap, Move, Delete…), the bulk import commit. The panel stays visible
 *  underneath, dimmed and unclickable, with a short reason so a
 *  multi-second wait doesn't read as a freeze. Parent needs `position: relative`. */
export function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="ui-loading-overlay" role="status" aria-live="polite">
      <Loader2 size={22} aria-hidden="true" className="ui-spin" style={{ color: 'var(--machine)' }} />
      <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{label}</span>
    </div>
  );
}

/** Standard "nothing here" block — a table/list with zero rows, whether
 *  that's genuinely empty or a search/filter matched nothing. `action`
 *  is the one relevant next step (Clear filters, Add the first one), not
 *  a general-purpose button slot. */
export function EmptyState({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-[14px]">{title}</p>
      {subtitle && <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-3)' }}>{subtitle}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Standard "a GET failed" block — never leaves a blank page/panel behind
 *  a failed fetch. `message` should already be the translated, user-safe
 *  text (errorMessage() / useFetch's job, not this component's); the raw
 *  error goes to error_log server-side, never here. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-[14px]" style={{ color: 'var(--alert)' }}>{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="mt-3">
          <RotateCcw size={13} aria-hidden="true" />{t('common.retry')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOAST — a global, imperative notification queue instead of a React
// Context, since a toast is fired from event handlers scattered across the
// whole app (every save / delete / action), not read from component state.
// `toast.success(...)` etc. work from anywhere; `<ToastViewport />` (mounted
// once, in AppShell) is the only thing that actually renders them. Auto-
// dismiss keeps the queue from growing unbounded even if nobody clicks the
// dismiss button; an identical {tone, message} already showing is not
// re-queued, so a doubled event (e.g. a fast double-click that still only
// sends one request) can't stack two identical toasts.
// ---------------------------------------------------------------------------

type ToastTone = 'success' | 'info' | 'warning' | 'error';
type ToastItem = { id: string; tone: ToastTone; message: string };

let toastItems: ToastItem[] = [];
let toastListeners: ((items: ToastItem[]) => void)[] = [];

function emitToasts() {
  for (const listener of toastListeners) listener(toastItems);
}

function dismissToast(id: string) {
  toastItems = toastItems.filter((item) => item.id !== id);
  emitToasts();
}

function pushToast(tone: ToastTone, message: string) {
  if (toastItems.some((item) => item.tone === tone && item.message === message)) return;
  const id = crypto.randomUUID();
  toastItems = [...toastItems, { id, tone, message }];
  emitToasts();
  setTimeout(() => dismissToast(id), 4500);
}

export const toast = {
  success: (message: string) => pushToast('success', message),
  info: (message: string) => pushToast('info', message),
  warning: (message: string) => pushToast('warning', message),
  error: (message: string) => pushToast('error', message),
};

const TOAST_ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2, info: Info, warning: TriangleAlert, error: XCircle,
};

/** Mount exactly once (AppShell) — every `toast.*()` call anywhere in the
 *  app renders through this single portaled stack, top-right, above
 *  everything including open modals. */
export function ToastViewport() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>(toastItems);

  useEffect(() => {
    toastListeners.push(setItems);
    return () => { toastListeners = toastListeners.filter((l) => l !== setItems); };
  }, []);

  if (items.length === 0) return null;
  return createPortal(
    <div className="toast-viewport">
      {items.map((item) => {
        const Icon = TOAST_ICON[item.tone];
        return (
          <div key={item.id} className="toast-item" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>
            <Icon size={16} aria-hidden="true" className="toast-item-icon" />
            <span className="toast-item-message">{item.message}</span>
            <button type="button" onClick={() => dismissToast(item.id)} aria-label={t('common.close')} className="toast-item-close">
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/** The one visual marker for "this field is required" — Detail Panel
 *  fields, action screens and the account forms all use it, instead of
 *  relying on the browser's native validation popup to be the only sign a
 *  field wasn't optional. */
export function RequiredMark() {
  return <span style={{ color: 'var(--alert)' }} aria-hidden="true"> *</span>;
}
