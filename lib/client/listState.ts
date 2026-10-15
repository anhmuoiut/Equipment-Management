/**
 * Kiểu dùng chung của danh sách module: `ListState` (ModuleWorkspace / Masterlist đọc) và `PagedState` (danh sách phân trang ở server —
 * usePagedList). Danh sách nhỏ (Users, Configuration, Error log) không có `paged` và vẫn lọc / sắp xếp ở trình duyệt.
 */
export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Bộ tìm / lọc / sắp xếp của một danh sách phân trang — đúng những gì gửi lên server (xem lib/services/core/listQuery.ts). */
export type ListQuery = {
  /** Chữ tìm (đã debounce). */
  q: string;
  sort: SortState;
  /** Khóa cột → giá trị (mã enum, id, hoặc chữ); `__empty` = cột để trống. */
  filters: Record<string, string>;
  quick: string | null;
  /** Mã enum mà chữ tìm khớp với nhãn đã dịch: { usage: ['in_use'], status: ['overdue'] }. */
  enums: Record<string, string[]>;
};

export const EMPTY_QUERY: ListQuery = { q: '', sort: null, filters: {}, quick: null, enums: {} };
export const EMPTY_FILTER = '__empty';
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type PagedState<R> = {
  /** Tổng số dòng khớp bộ tìm / lọc (mọi trang). */
  total: number;
  page: number;
  pageSize: number;
  query: ListQuery;
  /** Đang hỏi server (các dòng đang hiện có thể là của trang / bộ lọc trước). */
  fetching: boolean;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Gộp vào bộ tìm / lọc / sắp xếp hiện tại; nếu có gì thật sự đổi thì về trang 1. */
  setQuery: (patch: Partial<ListQuery>) => void;
  /** Mọi dòng khớp bộ tìm / lọc hiện tại (xuất Excel) — một request riêng, chỉ khi người dùng bấm. */
  exportAll: () => Promise<R[]>;
};

export type ListState<R> = {
  rows: R[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  upsert: (row: R) => void;
  remove: (id: string) => void;
  /** Có ở danh sách phân trang ở server; vắng ở danh sách tải đủ về trình duyệt. */
  paged?: PagedState<R>;
};
