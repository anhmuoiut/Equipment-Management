'use client';

/**
 * Tùy chọn hiển thị cột (bảng desktop / tablet) — mỗi người tự ẩn / hiện, đổi
 * thứ tự, khôi phục mặc định. Lưu trên trình duyệt của từng người. Điện thoại
 * dùng thẻ (Masterlist) nên không có tùy chọn này.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAnchoredPopover } from '@/lib/client/useAnchoredPopover';
import { ToolbarButton } from './ToolbarButton';

export type ColumnPrefs = {
  order: string[];
  hidden: string[];
  toggle: (key: string) => void;
  move: (key: string, delta: -1 | 1) => void;
  reset: () => void;
};

/**
 * Mặc định của module: `defaults` = các cột hiện sẵn, theo đúng thứ tự này; các cột còn lại ẩn (xếp sau,
 * ai cần thì mở ở Tùy chọn hiển thị). Không khai báo `defaults` → hiện hết theo thứ tự của module.
 */
function defaultPrefs(keys: string[], defaults?: string[]): { order: string[]; hidden: string[] } {
  if (!defaults?.length) return { order: keys, hidden: [] };
  const shown = defaults.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !shown.includes(k));
  return { order: [...shown, ...rest], hidden: rest };
}

/** Cùng nội dung thì giữ nguyên mảng cũ: đặt lại một mảng mới y hệt sẽ vẽ lại cả bảng chỉ vì đổi identity. */
const keepIfSame = (previous: string[], next: string[]) =>
  previous.length === next.length && previous.every((k, i) => k === next[i]) ? previous : next;

export function useColumnPrefs(storageKey: string, keys: string[], defaults?: string[]): ColumnPrefs {
  const storage = `masterlist-columns:${storageKey}`;
  const initial = defaultPrefs(keys, defaults);
  const [order, setOrderState] = useState<string[]>(initial.order);
  const [hidden, setHiddenState] = useState<string[]>(initial.hidden);
  const setOrder = useCallback((next: string[]) => setOrderState((previous) => keepIfSame(previous, next)), []);
  const setHidden = useCallback((next: string[]) => setHiddenState((previous) => keepIfSame(previous, next)), []);
  const keySig = keys.join('|');
  const defaultSig = (defaults ?? []).join('|');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storage) ?? 'null') as { order?: string[]; hidden?: string[] } | null;
      const fallback = defaultPrefs(keys, defaults);
      if (saved?.order) {
        // Cột mới thêm sau này nối vào cuối; hiện hay ẩn theo mặc định của module.
        const known = saved.order.filter((k) => keys.includes(k));
        const added = keys.filter((k) => !known.includes(k));
        setOrder([...known, ...added]);
        setHidden([...(saved.hidden ?? []).filter((k) => keys.includes(k)), ...added.filter((k) => fallback.hidden.includes(k))]);
      } else {
        setOrder(fallback.order);
        setHidden(fallback.hidden);
      }
    } catch {
      const fallback = defaultPrefs(keys, defaults);
      setOrder(fallback.order);
      setHidden(fallback.hidden);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, keySig, defaultSig]);

  const persist = useCallback((nextOrder: string[], nextHidden: string[]) => {
    try { localStorage.setItem(storage, JSON.stringify({ order: nextOrder, hidden: nextHidden })); } catch {}
  }, [storage]);

  return {
    order,
    hidden,
    toggle: (key) => {
      const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
      setHidden(next);
      persist(order, next);
    },
    move: (key, delta) => {
      const i = order.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j]!, next[i]!];
      setOrder(next);
      persist(next, hidden);
    },
    reset: () => {
      const fallback = defaultPrefs(keys, defaults);
      setOrder(fallback.order);
      setHidden(fallback.hidden);
      try { localStorage.removeItem(storage); } catch {}
    },
  };
}

export function ColumnSettings({ columns, prefs }: { columns: { key: string; label: string }[]; prefs: ColumnPrefs }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const place = useAnchoredPopover({
    open, triggerRef: ref, align: 'end', minWidth: 260, preferredHeight: 360, onAnchorHidden: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  return (
    <div className="ml-colsettings" ref={ref}>
      <ToolbarButton label={t('ml.columns')} icon={<Columns3 size={14} aria-hidden="true" />}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" />
      {place && createPortal(
        <div ref={popoverRef} className="ml-popover" role="dialog" aria-label={t('ml.columns')} style={place}>
          <ul>
            {prefs.order.map((key, i) => {
              const col = columns.find((c) => c.key === key);
              if (!col) return null;
              return (
                <li key={key}>
                  <label>
                    <input type="checkbox" checked={!prefs.hidden.includes(key)} onChange={() => prefs.toggle(key)} />
                    <span>{col.label}</span>
                  </label>
                  <button type="button" onClick={() => prefs.move(key, -1)} disabled={i === 0} aria-label={t('ml.moveUp', { name: col.label })}>
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => prefs.move(key, 1)} disabled={i === prefs.order.length - 1} aria-label={t('ml.moveDown', { name: col.label })}>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button size="sm" onClick={prefs.reset}>{t('ml.resetColumns')}</Button>
        </div>, document.body,
      )}
    </div>
  );
}
