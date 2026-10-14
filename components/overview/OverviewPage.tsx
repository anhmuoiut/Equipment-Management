'use client';

/**
 * Overview (docs/DETAIL_MODEL.md 4.6): bảng thẻ theo Location — nhìn một lượt mọi Tester và thiết bị chưa gắn ở từng vị trí.
 * Dữ liệu là MỘT lần gọi `GET /api/overview` (lọc và tìm chạy trên server vì thẻ khớp có thể nằm sau "+N"). Bấm thẻ con mở
 * modal của chính nó; bấm thẻ gốc hoặc "+N thiết bị" mở modal của tài sản gốc ở tab Cây thiết bị (`?id=&type=&tab=tree`).
 * Thu gọn / mở section do người dùng chọn, nhớ trong tab đang mở; có bộ lọc thì mọi section tự mở.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useFetch } from '@/lib/client/useFetch';
import { useUrlParams } from '@/lib/client/useUrlParams';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { BoardSection, BoardSkeleton, type OpenCard } from './OverviewBoard';
import { OverviewRecord } from './OverviewRecord';
import type { AssetType, OverviewBoard } from '@/lib/types';

const ASSET_TYPES: AssetType[] = ['equipment', 'sub_equipment', 'golden_board'];
const KINDS = ['tester', 'base', 'fixture', 'sub_equipment', 'golden_board'] as const;
const USAGES = ['in_use', 'not_in_use'] as const;
/** Nhịp chờ sau khi ngừng gõ trước khi hỏi server. */
const SEARCH_DELAY = 300;

export function OverviewPage() {
  const { t } = useTranslation();
  const { searchParams, update, back } = useUrlParams();
  const urlId = searchParams.get('id');
  const urlType = searchParams.get('type') as AssetType | null;
  const urlTab = searchParams.get('tab');
  const modalOpen = !!urlId && !!urlType && ASSET_TYPES.includes(urlType);

  const [usage, setUsage] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const pushedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setText(query.trim()), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { if (!modalOpen) pushedRef.current = false; }, [modalOpen]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (usage) params.set('usage', usage);
    if (kind) params.set('kind', kind);
    if (text) params.set('q', text);
    const qs = params.toString();
    return qs ? `/api/overview?${qs}` : '/api/overview';
  }, [usage, kind, text]);
  // Giữ bảng cũ trong lúc tải lại (đổi bộ lọc, sau khi sửa trong modal): không nháy về khung xương.
  const board = useFetch<OverviewBoard>(url);
  const sections = board.data?.sections ?? null;

  const filtering = !!(usage || kind || text);
  // Tô thẻ khớp khi lọc theo Loại hoặc tìm chữ; lọc theo Status thì cả cột đều khớp nên không tô.
  const highlight = !!(kind || text);
  const reload = board.reload;

  const openCard = useCallback<OpenCard>((card, tab) => {
    const changes = { id: card.id, type: card.asset_type, tab: tab ?? null };
    if (modalOpen) update(changes, 'replace');
    else { pushedRef.current = true; update(changes, 'push'); }
  }, [modalOpen, update]);
  /** Nút trong cây / chip cha – con: mở ngay trong modal đang mở, kể cả khi là loại tài sản khác. */
  function openRelated(relatedType: AssetType, id: string) {
    update({ id, type: relatedType, tab: null }, 'replace');
  }
  function closeRecord() {
    if (pushedRef.current) { pushedRef.current = false; back(); } else update({ id: null, type: null, tab: null }, 'replace');
  }
  const toggle = useCallback((locationId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId); else next.add(locationId);
      return next;
    });
  }, []);
  function clearFilters() { setUsage(''); setKind(''); setQuery(''); setText(''); }

  let content;
  if (board.error && !sections) content = <ErrorState message={board.error} onRetry={reload} />;
  else if (!sections) content = <BoardSkeleton />;
  else if (sections.length === 0) {
    content = filtering
      ? <EmptyState title={t('ov.noMatch')} action={<Button size="sm" onClick={clearFilters}>{t('ml.clearFilters')}</Button>} />
      : <EmptyState title={t('ov.empty')} />;
  } else {
    content = sections.map((section) => (
      <BoardSection key={section.location_id} section={section} open={filtering || !collapsed.has(section.location_id)}
        onToggle={() => toggle(section.location_id)} highlight={highlight} onOpen={openCard} />
    ));
  }

  return (
    <div className="ob">
      <PageHeading title={t('nav.overview')} />
      <div className="ob-toolbar">
        <div className="ob-seg" role="group" aria-label={t('ov.usage')}>
          {[['', t('ml.all')], ...USAGES.map((u) => [u, t(`values.${u}`)])].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={usage === value} onClick={() => setUsage(value!)}>{label}</button>
          ))}
        </div>
        <SearchableSelect value={kind} onChange={setKind} ariaLabel={t('ov.kind')} placeholder={t('ov.kindAll')} clearable
          options={KINDS.map((k) => ({ value: k, label: t(`ov.kinds.${k}`) }))} className="ob-kind" />
        <label className="ml-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ov.searchPlaceholder')} aria-label={t('ov.searchPlaceholder')} />
        </label>
      </div>

      {board.error && sections && (
        <p className="ob-error" role="alert">
          {board.error} <Button size="sm" onClick={reload}>{t('common.retry')}</Button>
        </p>
      )}
      <div className="ob-body" role="region" aria-label={t('ov.board')} aria-busy={board.loading || undefined}>
        {content}
      </div>

      {modalOpen && urlId && urlType && (
        <OverviewRecord type={urlType} id={urlId} tab={urlTab} onClose={closeRecord} onChanged={reload} onOpen={openRelated} />
      )}
    </div>
  );
}
