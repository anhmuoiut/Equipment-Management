import 'server-only';

/**
 * Truy vấn danh sách có phân trang (Masterlist của Equipment, Calibration, Golden board).
 *
 * Phân trang, tìm, lọc và sắp xếp chạy Ở DATABASE trên các view `*_list` (migration 20261016000000): server chỉ đọc MỘT trang
 * (PostgREST `range` + `count`) thay vì cả bảng. Mỗi module khai báo một `ListSpec` (view, cột trả về, cột nào sắp xếp / lọc được);
 * phần còn lại — đọc tham số URL, kiểm tra giá trị, dựng truy vấn, kẹp trang vượt quá — dùng chung ở đây.
 *
 * Tham số URL (tất cả tùy chọn):
 *   page=2 · pageSize=25|50|100|all · q=chữ tìm · sort=<khóa cột> · dir=asc|desc · quick=<khóa> · f.<khóa>=<giá trị> (bộ lọc cột)
 *   · qe=usage:in_use,status:overdue (giá trị enum mà chữ gõ vào khớp với NHÃN đã dịch — trình duyệt biết nhãn, database chỉ có mã)
 * `pageSize=all` (xuất Excel) trả mọi dòng khớp, đọc từng 1000 dòng.
 */
import { AppError, mapRpcError } from '@/lib/errors';
import { db } from './db';
import { UUID_RE } from './validate';

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
/** Xuất Excel: tối đa bấy nhiêu dòng một lần (danh sách thật của app nhỏ hơn nhiều). */
export const MAX_EXPORT_ROWS = 10_000;
const READ_PAGE = 1000;
const MAX_QUERY = 100;
/** Giá trị bộ lọc "để trống" (cột không có giá trị). */
export const EMPTY_FILTER = '__empty';

export type SortDir = 'asc' | 'desc';

export type FilterDef =
  /** Một trong các mã cố định (usage, status, result…). */
  | { column: string; kind: 'enum'; values: readonly string[]; allowEmpty?: boolean }
  /** Khóa ngoại: id của dòng trong danh sách Configuration. */
  | { column: string; kind: 'id'; allowEmpty?: boolean }
  /** Chữ tự do (serial của cha, origin…): bằng đúng chữ đó. */
  | { column: string; kind: 'text'; allowEmpty?: boolean }
  /** Thẻ: id của thẻ mà dòng đang mang (cột tag_ids). */
  | { column: 'tag_ids'; kind: 'tag' };

export type ListSpec = {
  /** View đọc (migration 20261016000000). */
  view: string;
  /** Cột trả về — chỉ những cột danh sách cần. */
  select: string;
  /** Khóa cột của giao diện → cột của view để ORDER BY (cột `*_nk` = sắp xếp tự nhiên). */
  sort: Record<string, string>;
  /** Thứ tự khi chưa chọn cột nào; luôn kèm `id` làm khóa phụ để thứ tự ổn định. */
  defaultOrder: readonly (readonly [string, SortDir])[];
  filters: Record<string, FilterDef>;
  /** Nút lọc nhanh: khóa → các giá trị của một cột enum. */
  quick?: Record<string, { column: string; values: readonly string[] }>;
  /** Cột enum mà chữ tìm kiếm có thể khớp qua nhãn đã dịch (qe=). */
  searchEnums: Record<string, readonly string[]>;
};

export type ListParams = {
  page: number;
  pageSize: 25 | 50 | 100 | 'all';
  q: string;
  sort: string | null;
  dir: SortDir;
  filters: Record<string, string>;
  quick: string | null;
  enums: Record<string, string[]>;
};

export type ListPage<T> = { rows: T[]; total: number; page: number; pageSize: number };

const invalid = (field: string) => new AppError('VALIDATION_ERROR', { fields: { [field]: 'invalid' } });

/** Đọc và kiểm tra tham số danh sách. Giá trị lạ → VALIDATION_ERROR (không bỏ qua âm thầm); trang sai → trang 1. */
export function parseListParams(sp: URLSearchParams, spec: ListSpec): ListParams {
  const pageNumber = Number(sp.get('page'));
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;

  const rawSize = sp.get('pageSize');
  let pageSize: ListParams['pageSize'] = DEFAULT_PAGE_SIZE;
  if (rawSize === 'all') pageSize = 'all';
  else if (rawSize !== null) {
    const size = Number(rawSize);
    if (!(PAGE_SIZES as readonly number[]).includes(size)) throw invalid('pageSize');
    pageSize = size as 25 | 50 | 100;
  }

  const sort = sp.get('sort');
  if (sort !== null && !(sort in spec.sort)) throw invalid('sort');
  const dir = sp.get('dir') === 'desc' ? 'desc' : 'asc';

  const filters: Record<string, string> = {};
  for (const [key, value] of sp.entries()) {
    if (!key.startsWith('f.')) continue;
    const name = key.slice(2);
    const def = spec.filters[name];
    if (!def) throw invalid(key);
    filters[name] = checkFilter(key, def, value);
  }

  const quick = sp.get('quick');
  if (quick !== null && !spec.quick?.[quick]) throw invalid('quick');

  const enums: Record<string, string[]> = {};
  for (const item of (sp.get('qe') ?? '').split(',').filter(Boolean)) {
    const [column, value] = item.split(':');
    if (!column || !value || !spec.searchEnums[column]?.includes(value)) throw invalid('qe');
    (enums[column] ??= []).push(value);
  }

  return { page, pageSize, q: (sp.get('q') ?? '').trim().slice(0, MAX_QUERY), sort, dir, filters, quick, enums };
}

function checkFilter(key: string, def: FilterDef, value: string): string {
  if (value === EMPTY_FILTER) {
    if (def.kind === 'tag' || def.allowEmpty) return value;
    throw invalid(key);
  }
  switch (def.kind) {
    case 'enum': if (def.values.includes(value)) return value; break;
    case 'id':
    case 'tag': if (UUID_RE.test(value)) return value; break;
    case 'text': if (value.length > 0 && value.length <= 200) return value; break;
  }
  throw invalid(key);
}

/** Một giá trị trong `or=(…)` của PostgREST: bọc nháy kép, thoát `\` và `"` (dấu phẩy, ngoặc, dấu chấm trong chữ gõ vào không phá được cú pháp). */
const orValue = (text: string) => `"${text.replace(/[\\"]/g, '\\$&')}"`;
/** % _ \ trong chữ gõ vào là ký tự thường (ilike). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** Điều kiện tìm: chữ nằm trong search_text của view, hoặc cột enum nằm trong các mã mà chữ khớp với nhãn. */
export function searchClause(q: string, enums: Record<string, string[]>): string {
  const parts = [`search_text.ilike.${orValue(likePattern(q.toLowerCase()))}`];
  for (const [column, values] of Object.entries(enums)) parts.push(`${column}.in.(${values.join(',')})`);
  return parts.join(',');
}

/** Phần của PostgrestFilterBuilder mà các truy vấn danh sách dùng (supabase-js trả về chính nó sau mỗi lời gọi). */
export type Query = {
  not(column: string, operator: string, value: unknown): Query;
  limit(count: number): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  in(column: string, values: readonly unknown[]): Query;
  contains(column: string, value: unknown): Query;
  or(filters: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
  then: PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string; details?: string } | null; count: number | null }>['then'];
};

function applyFilters(spec: ListSpec, p: ListParams, query: Query): Query {
  let q = query;
  for (const [name, value] of Object.entries(p.filters)) {
    const def = spec.filters[name]!;
    if (def.kind === 'tag') q = value === EMPTY_FILTER ? q.eq('tag_ids', '{}') : q.contains('tag_ids', [value]);
    else q = value === EMPTY_FILTER ? q.is(def.column, null) : q.eq(def.column, value);
  }
  if (p.quick) {
    const quick = spec.quick![p.quick]!;
    q = q.in(quick.column, quick.values);
  }
  if (p.q || Object.keys(p.enums).length > 0) {
    // Có nhãn enum khớp mà không có chữ tìm: chỉ lọc theo enum (không có điều kiện ilike).
    q = p.q ? q.or(searchClause(p.q, p.enums)) : q.or(Object.entries(p.enums).map(([c, v]) => `${c}.in.(${v.join(',')})`).join(','));
  }
  return q;
}

function applyOrder(spec: ListSpec, p: ListParams, query: Query): Query {
  let q = query;
  if (p.sort) q = q.order(spec.sort[p.sort]!, { ascending: p.dir === 'asc' });
  else for (const [column, dir] of spec.defaultOrder) q = q.order(column, { ascending: dir === 'asc' });
  return q.order('id', { ascending: true });
}

/**
 * Đọc một trang. Trang vượt quá số trang thật (xóa bớt dòng, đổi bộ lọc ở thẻ khác…) → trả trang cuối thay vì lỗi; `page` trong kết
 * quả là trang thực sự trả về. `pageSize = 'all'` trả mọi dòng khớp (xuất Excel).
 */
export async function runList<T>(spec: ListSpec, p: ListParams): Promise<ListPage<T>> {
  const base = () => applyOrder(spec, p, applyFilters(spec, p, db().from(spec.view).select(spec.select, { count: 'exact' }) as unknown as Query));
  const read = async (from: number, to: number) => {
    const { data, error, count } = await base().range(from, to);
    return { data: (data ?? []) as T[], error, count };
  };

  if (p.pageSize === 'all') {
    const first = await read(0, READ_PAGE - 1);
    if (first.error) throw mapRpcError(first.error);
    const total = Math.min(first.count ?? first.data.length, MAX_EXPORT_ROWS);
    const rows = first.data;
    const starts = Array.from({ length: Math.max(0, Math.ceil((total - READ_PAGE) / READ_PAGE)) }, (_, i) => (i + 1) * READ_PAGE);
    for (const part of await Promise.all(starts.map((from) => read(from, from + READ_PAGE - 1)))) {
      if (part.error) throw mapRpcError(part.error);
      rows.push(...part.data);
    }
    return { rows: rows.slice(0, total), total, page: 1, pageSize: total };
  }

  const size = p.pageSize;
  let page = p.page;
  for (let attempt = 0; attempt < 2; attempt++) {
    const from = (page - 1) * size;
    const result = await read(from, from + size - 1);
    if (!result.error) return { rows: result.data, total: result.count ?? result.data.length, page, pageSize: size };
    if (result.error.code !== 'PGRST103') throw mapRpcError(result.error);
    // Vượt quá: đọc một dòng để biết tổng số, rồi lấy trang cuối.
    const probe = await read(0, 0);
    if (probe.error) throw mapRpcError(probe.error);
    page = Math.max(1, Math.ceil((probe.count ?? 0) / size));
  }
  throw new AppError('SERVER_ERROR');
}
