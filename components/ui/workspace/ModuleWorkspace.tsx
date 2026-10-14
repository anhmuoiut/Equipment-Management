'use client';

/**
 * Trang của một module: Masterlist full chiều rộng + modal của bản ghi (docs/DETAIL_MODEL.md).
 * URL là nguồn sự thật: `?id=` (chi tiết, mở lại / chia sẻ được), `?new=1` (thêm mới), `?tool=` (công cụ
 * như Import). Mở từ danh sách → `push` (nút Back của trình duyệt đóng modal); chuyển bản ghi (‹ ›, thêm
 * mới → chi tiết) → `replace`. Module chỉ truyền cột và cách vẽ modal; bản ghi được tải theo id.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useFetch } from '@/lib/client/useFetch';
import { useUrlParams } from '@/lib/client/useUrlParams';
import { PageHeading } from '@/components/layout/PageHeading';
import { Masterlist, type Column, type QuickFilter } from '@/components/ui/masterlist/Masterlist';
import type { TrailItem } from '@/components/ui/record/RecordModal';
import type { AssetType } from '@/lib/types';

export type ListState<R> = {
  rows: R[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  upsert: (row: R) => void;
  remove: (id: string) => void;
};

/** Mảng rỗng cố định: `rows` phải giữ nguyên identity khi chưa có dữ liệu (Masterlist memo theo nó). */
const NO_ROWS: never[] = [];

/**
 * Tải danh sách của module một lần; sửa / thêm / xóa cập nhật tại chỗ, tải lại giữ dòng cũ. Quay lại trang thì hiện ngay
 * danh sách lần trước trong lúc tải bản mới (useFetch `cache`).
 */
export function useList<R extends { id: string }>(url: string): ListState<R> {
  const { data, setData, loading, error, reload } = useFetch<R[]>(url, { cache: true });
  return {
    rows: data ?? NO_ROWS, loading, error, reload,
    upsert: (row) => setData((list) => {
      const rows = list ?? [];
      return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows];
    }),
    remove: (id) => setData((list) => (list ?? []).filter((r) => r.id !== id)),
  };
}

/**
 * Những gì ModuleWorkspace đưa cho phần vẽ modal của module — phẳng, để module truyền thẳng vào
 * RecordModal (`<RecordModal {...ctx} />`) rồi bổ sung phần riêng.
 */
export type DetailCtx<R> = {
  record: R | null;
  /** Id đang được chọn: khác `record.id` trong lúc bản ghi vừa chọn còn đang tải (`record` vẫn là bản trước). */
  id?: string;
  creating: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  nav: { onPrev?: () => void; onNext?: () => void };
  trail: TrailItem[];
  onClose: () => void;
  /** `open = false`: thêm mới xong nhưng còn một màn hình nữa (mật khẩu tạm) — chỉ cập nhật danh sách. */
  onSaved: (row: R, created: boolean, open?: boolean) => void;
  onDeleted: (row: R) => void;
  /** Tải lại cả masterlist và bản ghi — khi thao tác đổi cả các dòng khác (Swap, Move, xóa cả cây). */
  reload: () => void;
  /** Tăng sau mỗi lần `reload` — phần tải riêng của modal (cây, thiết bị con) đưa vào URL để tải lại theo. */
  version: number;
  /** Giá trị điền sẵn của form thêm mới đang mở (ví dụ thêm thiết bị con: { parent_id }). */
  defaults?: Record<string, unknown>;
  /** Mở bản ghi trong cùng module; trackTrail=false chỉ thay lựa chọn hiện tại, không thêm breadcrumb. */
  open: (id: string, fromLabel: string, options?: { trackTrail?: boolean }) => void;
  /** Overview: mở một tài sản bất kỳ loại nào ngay trong modal này (thay vì chuyển sang trang module của nó). */
  openAny?: (type: AssetType, id: string) => void;
  /** Mở form thêm mới với giá trị điền sẵn. */
  create?: (defaults?: Record<string, unknown>) => void;
};

/** Công cụ của module (ví dụ Import Excel): nút trên thanh công cụ, mở một modal (`?tool=`). */
export type WorkspaceTool = {
  key: string;
  label: string;
  icon?: ReactNode;
  render: (ctx: { onClose: () => void; reload: () => void }) => ReactNode;
};

export function ModuleWorkspace<R extends { id: string }>({
  title, list, columns, storageKey, defaultColumns, exportName, quickFilters, leading, rowTone, canAdd, addLabel,
  tools, recordUrl, renderDetail, beforeList, mobileCard, mobileFilterKeys, searchPlaceholder, mobileEmptyState,
}: {
  title: string;
  list: ListState<R>;
  columns: Column<R>[];
  /** Thẻ dòng trên điện thoại (RowCard); mặc định dựng từ các cột. */
  mobileCard?: (row: R) => ReactNode;
  mobileFilterKeys?: string[];
  searchPlaceholder?: string;
  mobileEmptyState?: { title: string; subtitle: string };
  storageKey: string;
  /** Cột hiện sẵn, theo thứ tự này; cột khác ẩn (mở ở Tùy chọn hiển thị). */
  defaultColumns?: string[];
  exportName: string;
  quickFilters?: QuickFilter<R>[];
  leading?: { header: ReactNode; label: string; render: (row: R) => ReactNode };
  rowTone?: (row: R) => 'alert' | 'warn' | undefined;
  canAdd: boolean;
  addLabel?: string;
  /** Nút công cụ đứng sau Xuất Excel, trước + Thêm (điện thoại: mục trong menu ⋮). */
  tools?: WorkspaceTool[];
  /** API của một bản ghi, ví dụ (id) => `/api/equipment/${id}`. Không có: lấy bản ghi từ danh sách (Error log). */
  recordUrl?: (id: string) => string;
  renderDetail: (ctx: DetailCtx<R>) => ReactNode;
  /** Nội dung trên masterlist (ví dụ danh sách con của Configuration). */
  beforeList?: ReactNode;
}) {
  const { t } = useTranslation();
  const { searchParams, update, back } = useUrlParams();
  const id = searchParams.get('id');
  const creating = searchParams.get('new') === '1' && canAdd;
  const toolKey = searchParams.get('tool');
  const tool = tools?.find((x) => x.key === toolKey) ?? null;
  const open = id !== null || creating || tool !== null;

  const [viewIds, setViewIds] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [createDefaults, setCreateDefaults] = useState<Record<string, unknown> | undefined>();
  const [trailState, setTrailState] = useState<{ owner: string; items: { id: string; label: string }[] }>({ owner: '', items: [] });
  /** Modal này do một lần `push` mở ra: đóng bằng Back để lịch sử trình duyệt không thừa một bước. */
  const pushedRef = useRef(false);
  const lastSelected = useRef<string | null>(null);

  useEffect(() => { if (!open) pushedRef.current = false; }, [open]);

  /** Mở một màn hình của modal: từ danh sách (chưa có modal) thì push, đang ở trong modal thì replace. */
  const go = useCallback((changes: Record<string, string | null>) => {
    const base = { id: null, new: null, tool: null, ...changes };
    if (open) update(base, 'replace');
    else { pushedRef.current = true; update(base, 'push'); }
  }, [open, update]);

  const select = useCallback((rowId: string) => {
    lastSelected.current = rowId;
    setTrailState({ owner: '', items: [] });
    go({ id: rowId });
  }, [go]);

  const create = useCallback((defaults?: Record<string, unknown>) => {
    setCreateDefaults(defaults);
    go({ new: '1' });
  }, [go]);

  const close = useCallback(() => {
    const focusRow = lastSelected.current;
    setTrailState({ owner: '', items: [] });
    if (pushedRef.current) { pushedRef.current = false; back(); } else update({ id: null, new: null, tool: null }, 'replace');
    if (focusRow) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-id="${focusRow}"]`)?.focus());
  }, [back, update]);

  // Bản ghi theo id (chi tiết đầy đủ); useFetch giữ dữ liệu cũ khi đổi id nên che bằng id. Trong lúc chờ, hiện NGAY dòng của danh sách
  // (cùng một dạng dữ liệu với chi tiết — dịch vụ dùng chung một toRow) rồi thay bằng bản vừa tải; tải lỗi thì báo lỗi như cũ.
  const fetched = useFetch<R>(recordUrl && id && !creating ? recordUrl(id) : null);
  const fromList = useMemo(() => (id ? list.rows.find((r) => r.id === id) ?? null : null), [id, list.rows]);
  const loaded = fetched.data && fetched.data.id === id ? fetched.data : null;
  const record = recordUrl ? (loaded ?? (fetched.error ? null : fromList)) : fromList;
  const reload = useCallback(() => { setVersion((v) => v + 1); list.reload(); fetched.reload(); }, [list, fetched]);

  const index = id ? viewIds.indexOf(id) : -1;
  const prevId = index > 0 ? viewIds[index - 1] : undefined;
  const nextId = index >= 0 && index < viewIds.length - 1 ? viewIds[index + 1] : undefined;
  const nav = useMemo(() => ({
    onPrev: prevId ? () => { lastSelected.current = prevId; update({ id: prevId }, 'replace'); } : undefined,
    onNext: nextId ? () => { lastSelected.current = nextId; update({ id: nextId }, 'replace'); } : undefined,
  }), [prevId, nextId, update]);

  const items = trailState.owner === id || trailState.items.length === 0 ? trailState.items : [];
  const trail: TrailItem[] = items.map((item, i) => ({
    label: item.label,
    onClick: () => {
      setTrailState({ owner: item.id, items: items.slice(0, i) });
      update({ id: item.id }, 'replace');
    },
  }));

  const detail: DetailCtx<R> = {
    record: creating ? null : record,
    id: id ?? undefined,
    creating,
    loading: (recordUrl ? fetched.loading : list.loading) && !record,
    error: recordUrl ? fetched.error : !record && list.error ? list.error : !record && !list.loading && id ? t('dp.notFound') : null,
    onRetry: recordUrl ? fetched.reload : list.reload,
    nav,
    trail,
    onClose: close,
    onSaved: (saved, created, openDetail = true) => {
      list.upsert(saved);
      if (created && !openDetail) return;
      if (created) {
        lastSelected.current = saved.id;
        fetched.setData(saved);
        update({ new: null, id: saved.id }, 'replace');
      } else fetched.setData(saved);
    },
    onDeleted: (deleted) => { list.remove(deleted.id); close(); },
    reload,
    version,
    defaults: creating ? createDefaults : undefined,
    open: (target, fromLabel, options) => {
      if (!id) return;
      setTrailState({ owner: target, items: options?.trackTrail === false ? [] : [...items, { id, label: fromLabel }] });
      update({ id: target }, 'replace');
    },
    create: canAdd ? create : undefined,
  };

  return (
    <div className="ws" data-open={open || undefined} data-add={canAdd || undefined}>
      <PageHeading title={title} subtitle={list.loading ? undefined : t('ml.count', { count: viewIds.length, total: list.rows.length })} />
      {beforeList}
      {/* Điện thoại: một nút + nổi cho mọi module (CSS ẩn nó trên desktop, nơi có nút + Thêm trên thanh công cụ). */}
      {canAdd && !open && (
        <button type="button" className="ws-add-fab" aria-label={addLabel ?? t('ml.add')}
          title={addLabel ?? t('ml.add')} onClick={() => create()}>
          <Plus size={26} aria-hidden="true" />
        </button>
      )}
      <div className="ws-main">
        <div className="ws-list">
          <Masterlist
            title={title} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
            columns={columns} mobileCard={mobileCard} storageKey={storageKey} defaultColumns={defaultColumns} exportName={exportName} quickFilters={quickFilters}
            leading={leading} rowTone={rowTone} selectedId={id} onSelect={select}
            onAdd={canAdd ? () => create() : undefined}
            addLabel={addLabel} onViewChange={setViewIds} initialSearch={searchParams.get('q') ?? undefined}
            mobileFilterKeys={mobileFilterKeys} searchPlaceholder={searchPlaceholder} mobileEmptyState={mobileEmptyState}
            tools={tools?.map((x) => ({
              key: x.key, label: x.label, icon: x.icon, active: toolKey === x.key,
              onClick: () => go({ tool: x.key }),
            }))}
          />
        </div>
      </div>
      {/* key: thêm mới (M) → chi tiết (L) là hai modal khác nhau; mỗi bản ghi mở thẳng cũng là một modal mới. */}
      {tool ? <Fragment key={`tool:${tool.key}`}>{tool.render({ onClose: close, reload: list.reload })}</Fragment>
        : (id !== null || creating) && <Fragment key={creating ? 'new' : 'record'}>{renderDetail(detail)}</Fragment>}
    </div>
  );
}
