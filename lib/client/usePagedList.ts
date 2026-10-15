'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/client/api';
import { pagedCache, type PagedEntry, type PagedMeta } from '@/lib/client/cache';
import {
  DEFAULT_PAGE_SIZE, EMPTY_QUERY, PAGE_SIZE_OPTIONS, type ListQuery, type ListState,
} from '@/lib/client/listState';
import { useUrlParams } from '@/lib/client/useUrlParams';

/** Các trang đang hiện / không có dữ liệu: mảng cố định để Masterlist (memo theo `rows`) không phải vẽ lại. */
const NO_ROWS: never[] = [];

/** URL của một trang: mọi tham số tạo nên KHÓA bộ nhớ (cache.ts). `pageSize = 'all'` (xuất Excel) không có số trang. */
export function pagedUrl(path: string, page: number, pageSize: number | 'all', query: ListQuery): string {
  const p = new URLSearchParams();
  if (pageSize !== 'all') p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  if (query.q) p.set('q', query.q);
  if (query.sort) { p.set('sort', query.sort.key); p.set('dir', query.sort.dir); }
  if (query.quick) p.set('quick', query.quick);
  const enums = Object.entries(query.enums).flatMap(([column, values]) => values.map((value) => `${column}:${value}`));
  if (enums.length > 0) p.set('qe', enums.join(','));
  for (const key of Object.keys(query.filters).sort()) p.set(`f.${key}`, query.filters[key]!);
  return `${path}?${p}`;
}

const sizeKey = (storageKey: string) => `em:pagesize:${storageKey}`;

function readPageSize(storageKey: string): number {
  try {
    const stored = Number(window.localStorage.getItem(sizeKey(storageKey)));
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(stored)) return stored;
  } catch { /* chặn lưu trữ (cửa sổ riêng tư…): dùng mặc định */ }
  return DEFAULT_PAGE_SIZE;
}

const sameQuery = (a: ListQuery, b: ListQuery) => JSON.stringify(a) === JSON.stringify(b);

function toMeta(meta: Record<string, unknown>, rows: number): PagedMeta {
  const total = Number(meta.total);
  return {
    total: Number.isFinite(total) ? total : rows,
    page: Number(meta.page) || 1,
    pageSize: Number(meta.pageSize) || DEFAULT_PAGE_SIZE,
  };
}

/**
 * Danh sách phân trang Ở SERVER (Equipment, Calibration, Golden): mỗi lần chỉ tải MỘT trang (cỡ 25 / 50 / 100), tìm / lọc / sắp xếp chạy ở
 * database nên áp dụng cho TOÀN BỘ dữ liệu, không chỉ trang đang hiện.
 *
 *  - Đổi chữ tìm, bộ lọc, sắp xếp hay cỡ trang → về trang 1. Chữ tìm do Masterlist debounce trước khi vào đây.
 *  - Giữ trang cũ trên màn hình (mờ đi) cho tới khi trang mới về — không nháy trống; phản hồi của URL cũ bị bỏ qua (đổi nhanh không lẫn).
 *  - Mỗi trang nhớ theo URL (cache.ts): trang còn tươi dùng luôn, không gọi server; trang cũ hiện ngay rồi tải lại ngầm. Mọi lần ghi của
 *    người dùng xóa sạch các trang nhớ (api.ts), nên không trang nào cũ còn sót sau Swap / Move / sửa / Import.
 *  - Server kẹp số trang vượt quá (xóa bớt dòng…) về trang cuối; hook theo `meta.page` mà không gọi lại.
 *  - `upsert` / `remove` (sau khi lưu / xóa trong modal): cập nhật ngay dòng đang hiện rồi tải lại trang ngầm, vì dòng vừa sửa có thể đổi
 *    chỗ hoặc không còn khớp bộ lọc.
 */
export function usePagedList<R extends { id: string }>(path: string, options: { storageKey: string }): ListState<R> {
  const { t } = useTranslation();
  const { searchParams } = useUrlParams();
  // `?q=` trên URL ("Xem trong Calibration" từ một tester) điền sẵn chữ tìm — chỉ đọc lúc mở trang.
  const [query, setQueryState] = useState<ListQuery>(() => ({ ...EMPTY_QUERY, q: searchParams.get('q') ?? '' }));
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => readPageSize(options.storageKey));
  const [version, setVersion] = useState(0);
  const force = useRef(false);

  const url = pagedUrl(path, page, pageSize, query);
  // Quay lại màn hình: trang đã nhớ hiện ngay ở lần vẽ đầu (không qua một khung trống), và chỉ coi là đang tải nếu đã cũ.
  const [result, setResult] = useState<PagedEntry | null>(() => pagedCache.get(url) ?? null);
  const [error, setError] = useState<unknown>(null);
  const [fetching, setFetching] = useState(() => !pagedCache.fresh(pagedCache.get(url)));

  useEffect(() => {
    const hit = pagedCache.get(url);
    const forced = force.current;
    force.current = false;
    // Tải lại có chủ đích (sau khi lưu / xóa): giữ nguyên các dòng đang hiện — chúng mới hơn bản đã nhớ.
    if (hit && !forced) setResult(hit);
    if (!forced && pagedCache.fresh(hit)) { setFetching(false); setError(null); return; }

    let current = true;
    const epoch = pagedCache.epoch();
    setFetching(true);
    setError(null);
    api.get<R[]>(url).then(({ data, meta }) => {
      const m = toMeta(meta, data.length);
      // Một phản hồi hỏi TRƯỚC một lần ghi mà đến SAU nó là dữ liệu cũ: dùng cho lần này nhưng không nhớ lại.
      if (pagedCache.epoch() === epoch) {
        pagedCache.set(url, data, m);
        if (m.page !== page) pagedCache.set(pagedUrl(path, m.page, pageSize, query), data, m);
      }
      if (!current) return;
      setResult({ rows: data, meta: m, at: Date.now() });
      if (m.page !== page) setPageState(m.page); // server kẹp về trang cuối
    }, (e: unknown) => { if (current) setError(e); })
      .finally(() => { if (current) setFetching(false); });
    return () => { current = false; };
  }, [url, version, path, page, pageSize, query]);

  const reload = useCallback(() => { force.current = true; setVersion((v) => v + 1); }, []);

  const setPage = useCallback((next: number) => setPageState(Math.max(1, Math.floor(next) || 1)), []);
  const setPageSize = useCallback((size: number) => {
    if (!(PAGE_SIZE_OPTIONS as readonly number[]).includes(size)) return;
    try { window.localStorage.setItem(sizeKey(options.storageKey), String(size)); } catch { /* không lưu được: chỉ mất nhớ lựa chọn */ }
    setPageSizeState(size);
    setPageState(1);
  }, [options.storageKey]);
  const setQuery = useCallback((patch: Partial<ListQuery>) => {
    setQueryState((previous) => {
      const next = { ...previous, ...patch };
      if (sameQuery(previous, next)) return previous;
      setPageState(1);
      return next;
    });
  }, []);

  const upsert = useCallback((row: R) => {
    setResult((previous) => {
      if (!previous || !previous.rows.some((r) => (r as R).id === row.id)) return previous;
      return { ...previous, rows: previous.rows.map((r) => ((r as R).id === row.id ? row : r)) };
    });
    reload();
  }, [reload]);
  const remove = useCallback((id: string) => {
    setResult((previous) => (previous ? { ...previous, rows: previous.rows.filter((r) => (r as R).id !== id) } : previous));
    reload();
  }, [reload]);

  const exportAll = useCallback(async () => (await api.get<R[]>(pagedUrl(path, 1, 'all', query))).data, [path, query]);

  const rows = (result?.rows as R[] | undefined) ?? NO_ROWS;
  const paged = useMemo(() => ({
    total: result?.meta.total ?? 0, page, pageSize, query, fetching, setPage, setPageSize, setQuery, exportAll,
  }), [result, page, pageSize, query, fetching, setPage, setPageSize, setQuery, exportAll]);

  return {
    rows, loading: fetching, error: error === null ? null : errorMessage(error, t), reload, upsert, remove, paged,
  };
}
