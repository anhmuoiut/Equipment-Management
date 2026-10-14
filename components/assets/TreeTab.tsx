'use client';

/**
 * Tab "Cây thiết bị" (docs/DETAIL_MODEL.md 4.1): cây thụt lề từ Tester gốc của thiết bị đang xem, gồm cả
 * sub-equipment và golden board. Mỗi dòng chỉ Part number + Serial (+ `Sub` / `Golden`). Bấm ▸/▾ chỉ mở / đóng
 * nhánh; bấm phần còn lại mở chi tiết (equipment: ngay trong modal; Sub / Golden: sang module của chúng).
 * Bàn phím: ↑ ↓ chọn dòng, → mở nhánh, ← đóng nhánh, Enter mở chi tiết.
 * Cây do modal tải (một lần, dùng chung với chip thiết bị con); tab chỉ vẽ.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button, ErrorState, Spinner } from '@/components/ui';
import type { AssetType, EquipmentTree, TreeNode } from '@/lib/types';

const keyOf = (n: Pick<TreeNode, 'asset_type' | 'id'>) => `${n.asset_type}:${n.id}`;
/** Cây nhỏ thì mở hết. */
const OPEN_ALL_UP_TO = 30;

type Row = { node: TreeNode; depth: number; guides: ('line' | 'blank')[]; last: boolean; hasKids: boolean };

export function TreeTab({ tree, error, onRetry, current, home, onOpen }: {
  /** Cây đã tải (`null` = đang tải). */
  tree: EquipmentTree | null;
  error?: string | null;
  onRetry: () => void;
  /** Thiết bị đang xem. */
  current: { type: AssetType; id: string };
  /** Thiết bị mà modal được mở cho; nút "Thiết bị hiện tại" quay về đây (mặc định: thiết bị đang xem). */
  home?: { type: AssetType; id: string };
  onOpen: (type: AssetType, id: string) => void;
}) {
  const { t } = useTranslation();
  const data = tree?.nodes ?? null;
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const currentKey = keyOf({ asset_type: current.type, id: current.id });

  const { kids, roots, parentOfKey } = useMemo(() => {
    const nodes = data ?? [];
    const ids = new Set(nodes.map((n) => n.id));
    const kids = new Map<string, TreeNode[]>();
    const parentOfKey = new Map<string, string>();
    const roots: TreeNode[] = [];
    nodes.forEach((n) => {
      if (n.parent_id && ids.has(n.parent_id)) {
        const parent = nodes.find((p) => p.id === n.parent_id)!;
        const pk = keyOf(parent);
        kids.set(pk, [...(kids.get(pk) ?? []), n]);
        parentOfKey.set(keyOf(n), pk);
      } else roots.push(n);
    });
    return { kids, roots, parentOfKey };
  }, [data]);

  // Mặc định: cây nhỏ mở hết; cây lớn mở chuỗi từ gốc tới thiết bị đang xem và một cấp con của nó.
  useEffect(() => {
    if (!data || expanded) return;
    if (data.length <= OPEN_ALL_UP_TO) { setExpanded(new Set(data.map(keyOf))); return; }
    const open = new Set<string>([currentKey]);
    for (let k = parentOfKey.get(currentKey); k; k = parentOfKey.get(k)) open.add(k);
    setExpanded(open);
  }, [data, expanded, currentKey, parentOfKey]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const set = new Set<string>();
    if (!q) return set;
    (data ?? []).forEach((n) => {
      if ((n.part_number ?? '').toLowerCase().includes(q) || n.serial_number.toLowerCase().includes(q)) set.add(keyOf(n));
    });
    return set;
  }, [data, q]);

  // Gõ tìm: mở các nhánh chứa dòng khớp.
  const openSet = useMemo(() => {
    const open = new Set(expanded ?? []);
    matches.forEach((k) => { for (let p = parentOfKey.get(k); p; p = parentOfKey.get(p)) open.add(p); });
    return open;
  }, [expanded, matches, parentOfKey]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (list: TreeNode[], depth: number, guides: ('line' | 'blank')[]) => {
      list.forEach((node, i) => {
        const children = kids.get(keyOf(node)) ?? [];
        const last = i === list.length - 1;
        out.push({ node, depth, guides, last, hasKids: children.length > 0 });
        if (children.length > 0 && openSet.has(keyOf(node))) walk(children, depth + 1, [...guides, last ? 'blank' : 'line']);
      });
    };
    walk(roots, 0, []);
    return out;
  }, [roots, kids, openSet]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function showCurrent() {
    const target = home ?? current;
    const targetKey = keyOf({ asset_type: target.type, id: target.id });
    const open = new Set(expanded ?? []);
    for (let k = parentOfKey.get(targetKey); k; k = parentOfKey.get(k)) open.add(k);
    setExpanded(open);
    setFocusKey(targetKey);
    requestAnimationFrame(() => Array.from(listRef.current?.querySelectorAll('li[data-key]') ?? [])
      .find((el) => el.getAttribute('data-key') === targetKey)?.scrollIntoView?.({ block: 'center' }));
    if (targetKey !== currentKey) onOpen(target.type, target.id);
  }

  useEffect(() => {
    if (!focusKey) return;
    const item = Array.from(listRef.current?.querySelectorAll('li[data-key]') ?? []).find((el) => el.getAttribute('data-key') === focusKey);
    item?.querySelector<HTMLElement>('.tree-row')?.focus();
  }, [focusKey]);

  function onKeyDown(e: React.KeyboardEvent, row: Row, index: number) {
    const key = keyOf(row.node);
    if (e.key === 'ArrowDown') { e.preventDefault(); const next = rows[index + 1]; if (next) setFocusKey(keyOf(next.node)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const prev = rows[index - 1]; if (prev) setFocusKey(keyOf(prev.node)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (row.hasKids && !openSet.has(key)) toggle(key); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (row.hasKids && openSet.has(key)) toggle(key);
      else { const parent = parentOfKey.get(key); if (parent) setFocusKey(parent); }
    } else if (e.key === 'Enter') { e.preventDefault(); openNode(row.node); }
  }

  function openNode(node: TreeNode) {
    if (keyOf(node) === currentKey) return;
    onOpen(node.asset_type, node.id);
  }

  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data || !expanded) return <Spinner label={t('common.loadingEllipsis')} />;

  return (
    <div className="tree">
      <div className="tree-toolbar">
        <label className="ml-search tree-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('eq.treeSearch')} aria-label={t('eq.treeSearch')} />
        </label>
        <Button size="sm" onClick={() => setExpanded(new Set(data.map(keyOf)))}>{t('eq.expandAll')}</Button>
        <Button size="sm" onClick={() => setExpanded(new Set())}>{t('eq.collapseAll')}</Button>
        <Button size="sm" onClick={showCurrent}>{t('eq.showCurrent')}</Button>
      </div>
      <p className="tree-count">{t('eq.treeCount', { count: data.length })}</p>
      <ul className="tree-list" role="tree" ref={listRef}>
        {rows.map((row, index) => {
          const key = keyOf(row.node);
          const isOpen = openSet.has(key);
          const n = row.node;
          return (
            <li key={key} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasKids ? isOpen : undefined}
              aria-selected={key === currentKey} data-key={key} data-current={key === currentKey || undefined}
              data-match={matches.has(key) || undefined}>
              <div className="tree-row" tabIndex={focusKey === key || (!focusKey && key === currentKey) ? 0 : -1}
                onClick={() => openNode(n)} onKeyDown={(e) => onKeyDown(e, row, index)} onFocus={() => setFocusKey(key)}
                title={`${n.part_number ?? '—'} ${n.serial_number}`}>
                {row.guides.map((g, i) => <span key={i} className="tree-guide" data-kind={g === 'line' ? 'line' : 'none'} aria-hidden="true" />)}
                {row.depth > 0 && <span className="tree-guide" data-kind={row.last ? 'last' : 'mid'} aria-hidden="true" />}
                {row.hasKids ? (
                  <button type="button" className="tree-toggle" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggle(key); }}
                    aria-label={isOpen ? t('eq.collapse') : t('eq.expand')}>
                    {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                  </button>
                ) : <span className="tree-toggle-space" aria-hidden="true" />}
                <span className="tree-pn">{n.part_number ?? '—'}</span>
                <span className="tree-sn">{n.serial_number}</span>
                {n.asset_type !== 'equipment' && <span className="tree-kind">{t(n.asset_type === 'sub_equipment' ? 'asset.kindSub' : 'asset.kindGolden')}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
