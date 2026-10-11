'use client';

/**
 * Menu of actions behind one button: **Thao tác ▾** in the Detail Modal footer, ⋮ in
 * the phone list toolbar. A popover next to its button (portaled, so a modal's
 * overflow never clips it) that opens upward when there is no room below —
 * the footer button is at the bottom of the screen. Rows are 48px on phones.
 * Destructive items sort last, in red. It is a popover, not a dialog: Escape
 * closes it before the modal underneath.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { useAnchoredPopover } from '@/lib/client/useAnchoredPopover';
import { Button } from '@/components/ui';

export type MoreItem = { key: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode };

export function ActionMenu({ items, busy, iconOnly, ariaLabel }: {
  items: MoreItem[];
  /** One item is running — the trigger spins and cannot reopen the menu. */
  busy?: boolean;
  /** Icon-only ⋮ trigger (needs `ariaLabel`); default is the text button with a chevron. */
  iconOnly?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const place = useAnchoredPopover({
    open, triggerRef, align: 'auto', minWidth: 210,
    preferredHeight: Math.min(400, items.length * 48 + 8),
    onAnchorHidden: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault(); close();
        triggerRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const sorted = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
  return (
    <div className="am" ref={triggerRef}>
      <Button size="sm" className={`am-trigger${iconOnly ? ' am-trigger--icon' : ''}`} loading={busy}
        onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={iconOnly ? ariaLabel : undefined}>
        {iconOnly ? <MoreVertical size={18} aria-hidden="true" /> : <>{t('dp.actionsMenu')}<ChevronDown size={14} aria-hidden="true" /></>}
      </Button>
      {place && createPortal(
        <ul ref={listRef} className="am-list" role="menu" style={place}>
          {sorted.map((item) => (
            <li key={item.key} role="none">
              <button type="button" role="menuitem" disabled={item.disabled} data-danger={item.danger || undefined}
                onClick={() => { setOpen(false); item.onClick(); }}>
                {item.icon}{item.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
