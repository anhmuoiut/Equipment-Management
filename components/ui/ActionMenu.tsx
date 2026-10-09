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
import { Button } from '@/components/ui';

export type MoreItem = { key: string; label: string; onClick: () => void; danger?: boolean; icon?: ReactNode };

type Place = { top?: number; bottom?: number; left?: number; right?: number; maxHeight: number };

export function ActionMenu({ items, busy, iconOnly, ariaLabel }: {
  items: MoreItem[];
  /** One item is running — the trigger spins and cannot reopen the menu. */
  busy?: boolean;
  /** Icon-only ⋮ trigger (needs `ariaLabel`); default is the text button with a chevron. */
  iconOnly?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const open = place !== null;

  function openMenu() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const wanted = items.length * 40 + 12;
    const below = window.innerHeight - r.bottom - margin - 4;
    const above = r.top - margin - 4;
    const upward = below < wanted && above > below;
    const alignLeft = r.left + r.width / 2 < window.innerWidth / 2;
    setPlace({
      ...(upward ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      ...(alignLeft ? { left: Math.max(margin, r.left) } : { right: Math.max(margin, window.innerWidth - r.right) }),
      maxHeight: Math.max(120, upward ? above : below),
    });
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const sorted = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
  return (
    <div className="am" ref={triggerRef}>
      <Button size="sm" className={`am-trigger${iconOnly ? ' am-trigger--icon' : ''}`} loading={busy}
        onClick={() => (open ? setPlace(null) : openMenu())} aria-expanded={open} aria-haspopup="menu" aria-label={iconOnly ? ariaLabel : undefined}>
        {iconOnly ? <MoreVertical size={18} aria-hidden="true" /> : <>{t('dp.actionsMenu')}<ChevronDown size={14} aria-hidden="true" /></>}
      </Button>
      {place && createPortal(
        <ul ref={listRef} className="am-list" role="menu" style={place}>
          {sorted.map((item) => (
            <li key={item.key} role="none">
              <button type="button" role="menuitem" data-danger={item.danger || undefined}
                onClick={() => { setPlace(null); item.onClick(); }}>
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
