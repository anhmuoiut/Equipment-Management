import 'server-only';

/**
 * Giá trị cho các bộ lọc cột của Masterlist mà KHÔNG lấy từ danh sách Configuration: serial của cha / tester, part number và origin của
 * golden board là chữ tự do trong chính dữ liệu. Trước đây trình duyệt đọc chúng từ các dòng đã tải; giờ danh sách chỉ có một trang nên
 * server trả riêng, một lần cho mỗi module (trình duyệt nhớ, server nhớ 60 giây — readCache.ts).
 *
 * Danh sách "cha" là mọi equipment đang có con (tập cha thật của module có thể nhỏ hơn: chọn một giá trị không có dòng nào thì danh sách
 * trống, như một bộ lọc bất kỳ). Tối đa 1000 giá trị mỗi bộ lọc.
 */
import { db } from './core/db';
import type { Query } from './core/listQuery';
import { createReadCache } from './core/readCache';
import { AppError, mapRpcError } from '@/lib/errors';

export const FILTER_LISTS = ['equipment', 'calibration', 'golden'] as const;
export type FilterList = typeof FILTER_LISTS[number];
export type FilterValues = Record<string, string[]>;

const LIMIT = 1000;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

type Source = { view: string; column: string; where?: (q: Query) => Query };

/** Giá trị khác nhau của một cột (PostgREST không có DISTINCT: đọc tối đa LIMIT dòng rồi bỏ trùng). */
async function distinct({ view, column, where }: Source): Promise<string[]> {
  const base = db().from(view).select(column).not(column, 'is', null) as unknown as Query;
  const { data, error } = await (where ? where(base) : base).limit(LIMIT);
  if (error) throw mapRpcError(error);
  const values = new Set((data ?? []).map((row) => String((row as Record<string, unknown>)[column])));
  return [...values].sort((a, b) => collator.compare(a, b));
}

const parents = (kinds: readonly string[]): Source => ({
  view: 'equipment_list', column: 'serial_number', where: (q) => q.eq('has_children', true).in('kind', kinds),
});

const SOURCES: Record<FilterList, Record<string, Source>> = {
  equipment: { parent: parents(['tester', 'base', 'fixture']) },
  calibration: { tester: parents(['tester']) },
  golden: {
    parent: parents(['tester', 'fixture']),
    part_number: { view: 'golden_list', column: 'part_number' },
    origin: { view: 'golden_list', column: 'origin' },
  },
};

const caches = Object.fromEntries(FILTER_LISTS.map((list) => [list, createReadCache<FilterValues>(60_000)])) as Record<FilterList, ReturnType<typeof createReadCache<FilterValues>>>;

export function parseFilterList(value: string | undefined): FilterList {
  if (!FILTER_LISTS.includes(value as FilterList)) throw new AppError('NOT_FOUND');
  return value as FilterList;
}

export function filterValues(list: FilterList): Promise<FilterValues> {
  return caches[list].get(async () => {
    const entries = await Promise.all(Object.entries(SOURCES[list]).map(async ([key, source]) => [key, await distinct(source)] as const));
    return Object.fromEntries(entries);
  });
}
