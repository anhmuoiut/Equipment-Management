'use client';

/**
 * Masterlist — trang danh sách dùng chung cho mọi module (docs/UI.md). Mỗi module chỉ khai báo cột; khung lo tìm kiếm, bộ lọc, sắp xếp,
 * tùy chọn hiển thị cột, xuất Excel, chọn dòng.
 *
 * Hai chế độ. Danh sách nhỏ (Users, Configuration, Error log): dữ liệu tải đủ ở client nên lọc / sắp xếp tức thì. Danh sách lớn (Equipment,
 * Calibration, Golden — `server`): chỉ MỘT trang nằm ở client; tìm (debounce), lọc, sắp xếp, quick filter và phân trang đều gửi lên server
 * (usePagedList) và chạy ở database trên toàn bộ dữ liệu; thanh phân trang ở cuối. Giao diện giữ nguyên ở cả hai chế độ.
 *
 * Thứ tự đang hiện được báo lên (onViewChange) để Detail Panel chuyển ‹ › đúng thứ tự đó (chế độ server: trong trang đang xem).
 *
 * Điện thoại (< 768px): không ép bảng vào màn hình hẹp — mỗi dòng là một thẻ
 * (`mobileCard` của module, hoặc thẻ chung dựng từ các cột); thanh công cụ chỉ
 * còn tìm kiếm + Lọc & sắp xếp (tấm trượt từ đáy) + menu ⋮ (Xuất Excel, công cụ).
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, Filter, Inbox, Plus, Search, X } from 'lucide-react';
import { errorMessage } from '@/lib/client/api';
import { usePhone } from '@/lib/client/usePhone';
import { Button, EmptyState, ErrorState, Modal, Skeleton, TableSkeleton, toast } from '@/components/ui';
import { ActionMenu, type MoreItem } from '@/components/ui/ActionMenu';
import { SearchableSelect, type SelectOption } from '@/components/ui/SearchableSelect';
import { EMPTY_FILTER, type PagedState, type SortState } from '@/lib/client/listState';
import { ColumnSettings, useColumnPrefs } from './ColumnSettings';
import { Pager } from './Pager';
import { ToolbarButton } from './ToolbarButton';
import { exportToExcel } from './exportExcel';

export type Column<R> = {
  key: string;
  label: string;
  /** Giá trị để tìm, lọc, sắp xếp, xuất Excel. */
  value: (row: R) => string | number | null;
  /** Hiển thị trong ô (mặc định: value). */
  render?: (row: R) => ReactNode;
  /** Có bộ lọc chọn từ các giá trị đang có. */
  filter?: boolean;
  /** Bề rộng tối thiểu (px). */
  width?: number;
  /** Cho phép xuống dòng (mặc định không). */
  wrap?: boolean;
  /** Chế độ server: các lựa chọn của bộ lọc (value gửi lên server, label hiện cho người dùng) — không còn suy ra từ các dòng đã tải. */
  choices?: SelectOption[];
  /** Chế độ server: bộ lọc có thêm lựa chọn "(trống)" — cột cho phép giá trị trống. */
  emptyChoice?: boolean;
  /** Chế độ server: chữ tìm khớp NHÃN của một lựa chọn (đã dịch: "In use", "Overdue"…) thì cũng khớp các dòng mang giá trị đó. */
  searchByLabel?: boolean;
};

export type QuickFilter<R> = { key: string; label: string; test: (row: R) => boolean };

/** Công cụ của module (Import…): nút trên thanh công cụ desktop, mục trong menu ⋮ trên điện thoại. */
export type ListTool = { key: string; label: string; icon?: ReactNode; active?: boolean; onClick: () => void };

/** Sheet trên điện thoại: mọi lựa chọn đều là dropdown mở ngay dưới ô. */
function SheetSelect({ label, value, onChange, options, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  return (
    <div className="ml-filter">
      <span>{label}</span>
      <SearchableSelect inline value={value} onChange={onChange} options={options} disabled={disabled}
        ariaLabel={label} className="ml-sheet-select" />
    </div>
  );
}

const PAGE = 200;
/** Chế độ server: chờ người dùng gõ xong rồi mới hỏi server (không một request cho mỗi phím). */
const SEARCH_DEBOUNCE_MS = 350;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null || a === '') return 1;
  if (b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Nội dung một thẻ dòng trên điện thoại: tiêu đề (+ tag bên phải) và vài dòng phụ.
 * Chỉ dùng phần tử inline — thẻ nằm trong một <button>.
 */
export function RowCard({ title, tag, lines }: { title: ReactNode; tag?: ReactNode; lines?: ReactNode[] }) {
  return (
    <>
      <span className="rc-head">
        <span className="rc-title">{title}</span>
        {tag && <span className="rc-tag">{tag}</span>}
      </span>
      {lines?.map((line, i) => (line ? <span key={i} className="rc-line">{line}</span> : null))}
    </>
  );
}

/** Thẻ chung cho module không khai báo `mobileCard`: cột đầu là tiêu đề, vài cột sau là cặp nhãn – giá trị. */
function GenericCard<R>({ row, columns }: { row: R; columns: Column<R>[] }) {
  const cell = (c: Column<R>) => (c.render ? c.render(row) : c.value(row));
  const [first, ...rest] = columns;
  const pairs = rest
    .map((c) => ({ c, v: cell(c) }))
    .filter(({ v }) => v !== null && v !== undefined && v !== '')
    .slice(0, 5);
  return (
    <RowCard
      title={first ? cell(first) : null}
      lines={[pairs.length > 0 && pairs.map(({ c, v }) => (
        <span key={c.key} className="rc-pair"><span className="rc-key">{c.label}</span> {v}</span>
      ))]}
    />
  );
}

type Tone = 'alert' | 'warn' | undefined;

/**
 * Một dòng của bảng. memo: mở modal, đổi dòng đang chọn hay gõ vào ô tìm không vẽ lại cả trăm dòng — chỉ dòng nào đổi dữ liệu / cột /
 * trạng thái chọn. Mọi thứ truyền vào đều là giá trị cố định (onSelect đi qua ref), nên so sánh nông là đủ.
 */
function TableRowView<R extends { id: string }>({ row, index, columns, leading, selected, tone, onSelect }: {
  row: R; index: number; columns: Column<R>[]; leading: { render: (row: R) => ReactNode } | undefined;
  selected: boolean; tone: Tone; onSelect: (id: string) => void;
}) {
  return (
    <tr data-row-id={row.id} data-selected={selected || undefined} data-tone={tone}
      tabIndex={0} onClick={() => onSelect(row.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.id); } }}>
      {leading && <td className="ml-col-leading">{leading.render(row)}</td>}
      <td className="ml-col-no">{index + 1}</td>
      {columns.map((c) => {
        const value = c.value(row);
        const content = c.render ? c.render(row) : value;
        return (
          <td key={c.key} title={String(value ?? '')} data-wrap={c.wrap || undefined}>
            {content === null || content === '' || content === undefined ? <span className="ml-empty">—</span>
              : c.wrap ? <div className="ml-clamp">{content}</div> : content}
          </td>
        );
      })}
    </tr>
  );
}
const TableRow = memo(TableRowView) as typeof TableRowView;

/** Một thẻ dòng trên điện thoại — memo như TableRow. */
function CardView<R extends { id: string }>({ row, columns, mobileCard, selected, tone, onSelect }: {
  row: R; columns: Column<R>[]; mobileCard: ((row: R) => ReactNode) | undefined;
  selected: boolean; tone: Tone; onSelect: (id: string) => void;
}) {
  const usage = 'usage' in row && (row.usage === 'in_use' || row.usage === 'not_in_use') ? row.usage : undefined;
  return (
    <li>
      <button type="button" className="ml-card" data-row-id={row.id} data-selected={selected || undefined}
        data-tone={tone} data-usage={usage} onClick={() => onSelect(row.id)}>
        {mobileCard ? mobileCard(row) : <GenericCard row={row} columns={columns} />}
      </button>
    </li>
  );
}
const Card = memo(CardView) as typeof CardView;

export function Masterlist<R extends { id: string }>({
  title, rows, loading, error, onRetry, columns, storageKey, defaultColumns, selectedId, onSelect,
  onAdd, addLabel, tools, exportName, onExport, quickFilters, leading, onViewChange, rowTone, mobileCard, initialSearch,
  mobileFilterKeys, searchPlaceholder, mobileEmptyState, server,
}: {
  title: string;
  rows: R[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  columns: Column<R>[];
  /** Khóa lưu tùy chọn cột trên trình duyệt. */
  storageKey: string;
  /** Cột hiện sẵn, theo thứ tự này (cột khác ẩn, mở ở Tùy chọn hiển thị). Bỏ trống = hiện hết. */
  defaultColumns?: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Thêm mới: nút `+ Thêm` trên desktop (điện thoại dùng nút nổi của ModuleWorkspace). */
  onAdd?: () => void;
  addLabel?: string;
  tools?: ListTool[];
  exportName: string;
  /** Thay cách xuất mặc định (các cột đang hiện): Configuration xuất đúng file mẫu import, đầy đủ dữ liệu. */
  onExport?: () => Promise<void>;
  quickFilters?: QuickFilter<R>[];
  /** Cột đầu trước `No` (Equipment: quan hệ cha–con). */
  leading?: { header: ReactNode; label: string; render: (row: R) => ReactNode };
  onViewChange?: (ids: string[]) => void;
  /** Tô nền dòng (ví dụ quá hạn). */
  rowTone?: (row: R) => 'alert' | 'warn' | undefined;
  /** Thẻ dòng trên điện thoại (xem RowCard); mặc định dựng từ các cột. */
  mobileCard?: (row: R) => ReactNode;
  /** Chữ tìm kiếm điền sẵn (`?q=` trên URL: "Xem trong Calibration" từ một tester). */
  initialSearch?: string;
  /** Filters shown first in the phone sheet; other filters remain under More filters & sort. */
  mobileFilterKeys?: string[];
  searchPlaceholder?: string;
  mobileEmptyState?: { title: string; subtitle: string };
  /** Có: danh sách phân trang ở server — `rows` là MỘT trang; tìm / lọc / sắp xếp / trang đi qua đây (usePagedList). */
  server?: PagedState<R>;
}) {
  const { t } = useTranslation();
  const phone = usePhone();
  const [search, setSearch] = useState(initialSearch ?? '');
  // Ô tìm kiếm cập nhật ngay; lọc + vẽ lại danh sách chạy sau (ngắt được) nên gõ phím không bị khựng khi danh sách dài.
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [quick, setQuick] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [draftSort, setDraftSort] = useState<SortState>(null);
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const columnKeys = columns.map((c) => c.key);
  const prefs = useColumnPrefs(storageKey, columnKeys, defaultColumns);
  const sentinelRef = useRef<HTMLElement | null>(null);
  // onSelect đổi mỗi lần modal mở / đóng; dòng (memo) chỉ cần một hàm cố định gọi bản mới nhất.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const select = useCallback((id: string) => onSelectRef.current(id), []);
  // Chữ để tìm của từng dòng (mọi cột, viết thường) — tính MỘT lần cho mỗi lần dữ liệu / cột đổi, không phải mỗi lần gõ phím.
  const searchTexts = useRef<{ rows: R[]; columns: Column<R>[]; texts: string[] } | null>(null);

  const visibleColumns = useMemo(
    () => prefs.order.map((k) => columns.find((c) => c.key === k)).filter((c): c is Column<R> => !!c && !prefs.hidden.includes(c.key)),
    [columns, prefs.order, prefs.hidden],
  );

  const filterable = columns.filter((c) => c.filter);
  const phoneFilters = mobileFilterKeys
    ? mobileFilterKeys.flatMap((key) => filterable.filter((c) => c.key === key))
    : filterable;
  const extraPhoneFilters = mobileFilterKeys ? filterable.filter((c) => !mobileFilterKeys.includes(c.key)) : [];
  const filterValues = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (server) return out; // chế độ server: lựa chọn bộ lọc do cột khai báo (`choices`), không suy ra từ một trang
    filterable.forEach((c) => {
      const set = new Set<string>(c.key === 'parent' ? [''] : []);
      rows.forEach((r) => { const v = c.value(r); set.add(v === null || v === '' ? '' : String(v)); });
      out[c.key] = [...set].sort((a, b) => compare(a || null, b || null));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  const view = useMemo(() => {
    if (server) return rows; // đã tìm / lọc / sắp xếp / cắt trang ở server
    const q = deferredSearch.trim().toLowerCase();
    const quickTest = quickFilters?.find((f) => f.key === quick)?.test;
    const checks = Object.entries(filters).flatMap(([key, wanted]) => {
      const col = columns.find((c) => c.key === key);
      return col ? [{ col, wanted }] : [];
    });
    let texts: string[] | null = null;
    if (q) {
      const cached = searchTexts.current;
      if (cached && cached.rows === rows && cached.columns === columns) texts = cached.texts;
      else {
        texts = rows.map((r) => columns.map((c) => { const v = c.value(r); return v === null ? '' : String(v); }).join('\u0001').toLowerCase());
        searchTexts.current = { rows, columns, texts };
      }
    }
    let out = rows.filter((r, i) => {
      if (quickTest && !quickTest(r)) return false;
      for (const { col, wanted } of checks) {
        const v = col.value(r);
        if ((v === null || v === '' ? '' : String(v)) !== wanted) return false;
      }
      return !texts || texts[i]!.includes(q);
    });
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        // Giá trị cột tính một lần cho mỗi dòng, không phải mỗi lần so sánh (so sánh chạy n·log n lần).
        const keys = new Map(out.map((r) => [r, col.value(r)] as const));
        out = [...out].sort((a, b) => {
          const res = compare(keys.get(a) ?? null, keys.get(b) ?? null);
          return sort.dir === 'asc' ? res : -res;
        });
      }
    }
    return out;
  }, [rows, deferredSearch, filters, sort, quick, quickFilters, columns, server]);

  // Chế độ server: chữ tìm (debounce) và bộ lọc / sắp xếp đi lên server. Chữ gõ khớp nhãn của một lựa chọn enum (usage, status, result) thì
  // gửi kèm mã của nó, để tìm "overdue" / "in use" vẫn ra như khi tìm trên các dòng đã tải. Trang về 1 khi có gì thật sự đổi (usePagedList).
  const setServerQuery = server?.setQuery;
  useEffect(() => {
    if (!setServerQuery) return;
    const id = setTimeout(() => {
      const text = search.trim();
      const needle = text.toLowerCase();
      const enums: Record<string, string[]> = {};
      if (needle) {
        for (const c of columns) {
          if (!c.searchByLabel) continue;
          const matched = (c.choices ?? []).filter((o) => o.label.toLowerCase().includes(needle)).map((o) => o.value);
          if (matched.length > 0) enums[c.key] = matched;
        }
      }
      setServerQuery({ q: text, enums });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search, columns, setServerQuery]);
  useEffect(() => { setServerQuery?.({ filters, sort, quick }); }, [filters, sort, quick, setServerQuery]);

  const ids = useMemo(() => view.map((r) => r.id), [view]);
  useEffect(() => { onViewChange?.(ids); }, [ids, onViewChange]);
  useEffect(() => { setLimit(PAGE); }, [deferredSearch, filters, sort, quick]);
  // Quay về desktop thì bỏ tấm lọc đang mở (desktop dùng khung lọc nằm trong trang).
  useEffect(() => { if (!phone) setFiltersOpen(false); }, [phone]);

  // Dòng đang mở nằm ngoài phần đã vẽ (ví dụ chuyển bằng ‹ ›) → vẽ thêm tới nó.
  useEffect(() => {
    if (!selectedId) return;
    const index = ids.indexOf(selectedId);
    if (index >= limit) setLimit(index + PAGE);
    requestAnimationFrame(() => {
      document.querySelector(`[data-row-id="${selectedId}"]`)?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [selectedId, ids, limit]);

  // Vẽ thêm khi cuộn gần cuối.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [view.length, limit, phone]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  }

  async function doExport() {
    setExporting(true);
    try {
      if (onExport) { await onExport(); return; }
      // Chế độ server: xuất MỌI dòng khớp bộ tìm / lọc (không chỉ trang đang xem) — một request riêng, chỉ khi người dùng bấm.
      const exportRows = server ? await server.exportAll() : view;
      await exportToExcel(exportName, [
        { label: t('ml.no'), value: (_r: R, i: number) => i + 1 },
        ...visibleColumns.map((c) => ({ label: c.label, value: (r: R) => c.value(r) })),
      ], exportRows);
    } catch (e) {
      // Ví dụ mất mạng khi tải thư viện Excel (tải khi cần).
      toast.error(errorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  const activeFilters = Object.entries(filters);
  const filtered = deferredSearch.trim() !== '' || activeFilters.length > 0 || quick !== null;
  /** Chữ của lựa chọn "để trống" (cột cha dùng dấu —). */
  const emptyLabel = (key: string) => t(key === 'parent' ? 'ml.emptyValue' : 'ml.empty');
  /** Các lựa chọn của bộ lọc một cột: chế độ server lấy từ cột; chế độ client lấy từ giá trị đang có trong các dòng. */
  const choicesFor = (c: Column<R>, empty: string): SelectOption[] => (server
    ? [...(c.choices ?? []), ...(c.emptyChoice ? [{ value: EMPTY_FILTER, label: empty }] : [])]
    : (filterValues[c.key] ?? []).map((value) => ({ value, label: value || empty })));
  /** Chữ hiện trên chip của một bộ lọc đang bật. */
  const chipText = (key: string, value: string, empty: string) => {
    const column = columns.find((c) => c.key === key);
    if (server && column) return choicesFor(column, empty).find((o) => o.value === value)?.label ?? value;
    return value || empty;
  };
  const offset = server ? (server.page - 1) * server.pageSize : 0;
  const nothingLoaded = server ? !filtered : rows.length === 0;
  const activeCount = activeFilters.length + (sort ? 1 : 0) + (quick ? 1 : 0);
  const draftCount = Object.keys(draftFilters).length + (draftSort ? 1 : 0);
  const sortLabel = sort ? columns.find((c) => c.key === sort.key)?.label : undefined;
  const colCount = visibleColumns.length + 1 + (leading ? 1 : 0);
  /** Chế độ server: cả trang đang có; chế độ client: vẽ từng đoạn 200 dòng khi cuộn. */
  const visible = server ? view : view.slice(0, limit);
  const setFilter = (key: string, value: string) => setFilters((f) => {
    const next = { ...f };
    if (value === '__all') delete next[key]; else next[key] = value;
    return next;
  });

  function openPhoneFilters() {
    setDraftFilters({ ...filters });
    setDraftSort(sort);
    setFiltersOpen(true);
  }

  const clearFilters = () => { setFilters({}); setSort(null); setQuick(null); };
  const sheetFilter = (c: Column<R>) => (
    <SheetSelect key={c.key} label={c.label} value={draftFilters[c.key] ?? '__all'}
      onChange={(value) => setDraftFilters((current) => {
        const next = { ...current };
        if (value === '__all') delete next[c.key]; else next[c.key] = value;
        return next;
      })}
      options={[{ value: '__all', label: t('ml.all') }, ...choicesFor(c, t('ml.emptyValue'))]} />
  );

  // Menu ⋮ trên điện thoại: Xuất Excel + công cụ của module (Import…).
  const menu: MoreItem[] = [
    { key: 'export', label: t('ml.export'), icon: <Download size={16} aria-hidden="true" />, disabled: server ? server.total === 0 : view.length === 0, onClick: () => void doExport() },
    ...(tools ?? []).map((x) => ({ key: x.key, label: x.label, icon: x.icon, onClick: x.onClick })),
  ];

  const toolButtons = tools?.map((x) => (
    <ToolbarButton key={x.key} label={x.label} icon={x.icon} aria-pressed={x.active} data-active={x.active} onClick={x.onClick} />
  ));

  return (
    <section className="ml" aria-label={title}>
      <div className="ml-toolbar">
        <label className="ml-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={phone && searchPlaceholder ? searchPlaceholder : t('ml.searchPlaceholder')} aria-label={t('common.search')}
          />
        </label>
        {phone ? (
          <>
            <Button className="ml-icon-btn" aria-label={t('ml.filters')} aria-expanded={filtersOpen} onClick={openPhoneFilters}>
              <Filter size={18} aria-hidden="true" />
              {activeCount > 0 && <span className="ml-badge">{activeCount}</span>}
            </Button>
            {menu.length > 0 && <ActionMenu items={menu} busy={exporting} iconOnly ariaLabel={t('ml.moreActions')} />}
          </>
        ) : (
          <>
            {filterable.length > 0 && (
              <Button size="sm" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
                <Filter size={14} aria-hidden="true" />{t('ml.filters')}
                {activeFilters.length > 0 && <span className="ml-badge">{activeFilters.length}</span>}
              </Button>
            )}
            {quickFilters?.map((f) => (
              <Button key={f.key} size="sm" aria-pressed={quick === f.key} data-active={quick === f.key}
                onClick={() => setQuick((q) => (q === f.key ? null : f.key))}>
                {f.label}
              </Button>
            ))}
            <div className="ml-toolbar-end">
              <ColumnSettings columns={columns} prefs={prefs} />
              <ToolbarButton label={t('ml.export')} icon={<Download size={14} aria-hidden="true" />}
                onClick={doExport} loading={exporting} disabled={server ? server.total === 0 : view.length === 0} />
              {toolButtons}
              {onAdd && (
                <Button size="sm" variant="primary" onClick={onAdd}>
                  <Plus size={14} aria-hidden="true" />{addLabel ?? t('ml.add')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {phone && quickFilters && quickFilters.length > 0 && (
        <div className="ml-quick">
          {quickFilters.map((f) => (
            <Button key={f.key} size="sm" aria-pressed={quick === f.key} data-active={quick === f.key}
              onClick={() => setQuick((q) => (q === f.key ? null : f.key))}>
              {f.label}
            </Button>
          ))}
        </div>
      )}

      {!phone && filtersOpen && filterable.length > 0 && (
        <div className="ml-filters">
          {filterable.map((c) => (
            <div key={c.key} className="ml-filter">
              <span>{c.label}</span>
              <SearchableSelect value={filters[c.key] ?? '__all'} onChange={(value) => setFilter(c.key, value)}
                ariaLabel={c.label} className="ml-filter-select"
                options={[{ value: '__all', label: t('ml.all') }, ...choicesFor(c, emptyLabel(c.key))]} />
            </div>
          ))}
          {activeFilters.length > 0 && <Button size="sm" onClick={() => setFilters({})}>{t('ml.clearFilters')}</Button>}
        </div>
      )}

      {(activeFilters.length > 0 || (phone && (sort || quick))) && !filtersOpen && (
        <div className="ml-chips">
          {activeFilters.map(([key, value]) => (
            <button key={key} type="button" className="ml-chip"
              data-usage={key === 'usage' ? (value === 'in_use' || value === t('values.in_use') ? 'in_use' : 'not_in_use') : undefined}
              aria-label={t('ml.removeFilter', { name: `${columns.find((c) => c.key === key)?.label ?? key}: ${chipText(key, value, t('ml.emptyValue'))}` })}
              onClick={() => setFilters((f) => { const n = { ...f }; delete n[key]; return n; })}>
              {phone ? <span className="ml-chip-dot" aria-hidden="true" /> : <>{columns.find((c) => c.key === key)?.label}: </>}
              {chipText(key, value, t(phone || key === 'parent' ? 'ml.emptyValue' : 'ml.empty'))} <X size={12} aria-hidden="true" />
            </button>
          ))}
          {phone && sort && (
            <button type="button" className="ml-chip" onClick={() => setSort(null)}>
              {sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
              {sortLabel} <X size={12} aria-hidden="true" />
            </button>
          )}
          {phone && quick && (
            <button type="button" className="ml-chip" onClick={() => setQuick(null)}>
              {quickFilters?.find((f) => f.key === quick)?.label}<X size={12} aria-hidden="true" />
            </button>
          )}
          {phone && <button type="button" className="ml-clear-all" onClick={clearFilters}>{t('ml.clearAll')}</button>}
        </div>
      )}

      <div className="ml-scroll" data-empty={phone && !loading && !error && view.length === 0 || undefined}
        data-fetching={server && loading && rows.length > 0 || undefined}>
        {phone ? (
          <ul className="ml-cards">
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="ml-card ml-card--skeleton" aria-hidden="true">
                  <Skeleton className="h-4" style={{ width: '45%' }} />
                  <Skeleton className="h-3" style={{ width: '80%' }} />
                </li>
              ))
            ) : (
              visible.map((r) => (
                <Card key={r.id} row={r} columns={columns} mobileCard={mobileCard} selected={r.id === selectedId}
                  tone={rowTone?.(r)} onSelect={select} />
              ))
            )}
            {!server && view.length > limit && <li ref={(el) => { sentinelRef.current = el; }} className="ml-more">{t('common.loadingEllipsis')}</li>}
          </ul>
        ) : (
          <table className="ml-table">
            <thead>
              <tr>
                {leading && <th className="ml-col-leading" aria-label={leading.label}>{leading.header}</th>}
                <th className="ml-col-no">{t('ml.no')}</th>
                {visibleColumns.map((c) => (
                  <th key={c.key} style={c.width ? { minWidth: c.width } : undefined}
                    aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="ml-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort?.key === c.key
                        ? (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)
                        : <ArrowUpDown size={12} aria-hidden="true" className="ml-sort-idle" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <TableSkeleton columns={colCount} />
              ) : (
                visible.map((r, i) => (
                  <TableRow key={r.id} row={r} index={offset + i} columns={visibleColumns} leading={leading}
                    selected={r.id === selectedId} tone={rowTone?.(r)} onSelect={select} />
                ))
              )}
              {!server && view.length > limit && <tr ref={(el) => { sentinelRef.current = el; }}><td colSpan={colCount} className="ml-more">{t('common.loadingEllipsis')}</td></tr>}
            </tbody>
          </table>
        )}
        {error && <ErrorState message={error} onRetry={onRetry} />}
        {!error && !loading && view.length === 0 && (
          phone ? (
            <div className="ml-empty-state">
              <div className="ml-empty-art" aria-hidden="true"><Inbox size={104} strokeWidth={1.1} /></div>
              <h2>{mobileEmptyState?.title ?? (nothingLoaded ? t('ml.emptyTitle') : t('ml.noMatch'))}</h2>
              <p>{mobileEmptyState?.subtitle ?? t('ml.adjustFilters')}</p>
              <Button onClick={() => { setSearch(''); clearFilters(); }}>{t('ml.clearFilters')}</Button>
            </div>
          ) : <EmptyState
            title={nothingLoaded ? t('ml.emptyTitle') : t('ml.noMatch')}
            action={!nothingLoaded ? (
              <Button size="sm" onClick={() => { setSearch(''); setFilters({}); setQuick(null); }}>{t('ml.clearFilters')}</Button>
            ) : onAdd ? (
              <Button size="sm" variant="primary" onClick={onAdd}><Plus size={14} aria-hidden="true" />{addLabel ?? t('ml.add')}</Button>
            ) : undefined}
          />
        )}
      </div>

      {server && (
        <Pager page={server.page} pageSize={server.pageSize} total={server.total} shown={rows.length} busy={loading}
          onPage={server.setPage} onPageSize={server.setPageSize} />
      )}

      {phone && filtersOpen && (
        <Modal sheet className="ml-filter-sheet" title={t('ml.filters')} onClose={() => setFiltersOpen(false)}
          headerAction={<button type="button" className="ml-sheet-reset" onClick={() => { setDraftFilters({}); setDraftSort(null); }}>{t('ml.reset')}</button>}
          footer={(
            <>
              <Button className="ml-sheet-action" onClick={() => setFiltersOpen(false)}>{t('common.cancel')}</Button>
              <Button className="ml-sheet-action" variant="primary" onClick={() => {
                setFilters(draftFilters); setSort(draftSort); setFiltersOpen(false);
              }}>{t('ml.applyFilters', { count: draftCount })}</Button>
            </>
          )}>
          <div className="ml-sheet-form">
            {phoneFilters.map(sheetFilter)}
            <details className="ml-sheet-more">
              <summary>{t('ml.moreFiltersAndSort')}<ChevronDown size={16} aria-hidden="true" /></summary>
              <div className="ml-sheet-form">
                {extraPhoneFilters.map(sheetFilter)}
                <SheetSelect label={t('ml.sortBy')} value={draftSort?.key ?? ''}
                  onChange={(value) => setDraftSort(value ? { key: value, dir: draftSort?.dir ?? 'asc' } : null)}
                  options={[
                    { value: '', label: t('ml.sortNone') },
                    ...columns.map((c) => ({ value: c.key, label: c.label })),
                  ]} />
                <SheetSelect label={t('ml.sortDirection')} value={draftSort?.dir ?? 'asc'} disabled={!draftSort}
                  onChange={(value) => {
                    if (draftSort && (value === 'asc' || value === 'desc')) setDraftSort({ ...draftSort, dir: value });
                  }}
                  options={[
                    { value: 'asc', label: t('ml.sortAsc') },
                    { value: 'desc', label: t('ml.sortDesc') },
                  ]} />
              </div>
            </details>
          </div>
        </Modal>
      )}
    </section>
  );
}
