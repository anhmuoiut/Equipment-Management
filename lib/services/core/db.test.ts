import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => client }));
const cache = vi.hoisted(() => ({ invalidateLookups: vi.fn() }));
vi.mock('./lookupCache', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lookupCache')>()), ...cache }));

import { appWrite, selectAll } from './db';

/** Một bảng giả có `total` dòng; mỗi lời gọi .range() ghi lại để kiểm tra các trang được tải thế nào. */
function table(total: number | null, size: number) {
  const ranges: [number, number][] = [];
  const rows = Array.from({ length: size }, (_, i) => ({ id: String(i).padStart(5, '0') }));
  client.from.mockReturnValue({
    select: (_cols: string, opts?: { count?: string }) => ({
      order: () => ({
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null, count: opts?.count ? total : null };
        },
      }),
    }),
  });
  return { ranges, rows };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('selectAll', () => {
  it('a table smaller than a page is ONE request', async () => {
    const t = table(3, 3);
    expect(await selectAll('equipment')).toHaveLength(3);
    expect(t.ranges).toEqual([[0, 999]]);
  });

  it('a big table: the first page reports the total and the other pages are fetched together, in order', async () => {
    const t = table(2500, 2500);
    const out = await selectAll<{ id: string }>('equipment');
    expect(out).toHaveLength(2500);
    expect(out.map((r) => r.id)).toEqual(t.rows.map((r) => r.id)); // order preserved
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('exactly one full page → no extra request for nothing beyond it (total = 1000)', async () => {
    const t = table(1000, 1000);
    expect(await selectAll('equipment')).toHaveLength(1000);
    expect(t.ranges).toEqual([[0, 999]]);
  });

  it('without a total (null) it still reads page after page until a short page', async () => {
    const t = table(null, 2100);
    expect(await selectAll('equipment')).toHaveLength(2100);
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('turns a database error into an AppError', async () => {
    client.from.mockReturnValue({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'x', code: '42P01' } }) }) }) });
    await expect(selectAll('nope')).rejects.toBeTruthy();
  });
});

describe('appWrite and the lookups cache', () => {
  it.each(['part_numbers', 'locations', 'types', 'type_groups', 'levels', 'departments', 'calibration_vendors', 'tags', 'user_profiles'])(
    'writing %s invalidates the cache', async (name) => {
      client.rpc.mockResolvedValue({ data: { id: 'x' }, error: null });
      await appWrite(name, 'update', 'x', { display_name: 'A' }, 'actor');
      expect(cache.invalidateLookups).toHaveBeenCalledTimes(1);
    });

  it('writing equipment does not (names do not depend on it)', async () => {
    client.rpc.mockResolvedValue({ data: { id: 'x' }, error: null });
    await appWrite('equipment', 'update', 'x', { remark: 'r' }, 'actor');
    expect(cache.invalidateLookups).not.toHaveBeenCalled();
  });

  it('invalidates even when the write fails', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'DUPLICATE_VALUE', code: '23505' } });
    await expect(appWrite('locations', 'insert', null, { display_name: 'A' }, 'actor')).rejects.toBeTruthy();
    expect(cache.invalidateLookups).toHaveBeenCalledTimes(1);
  });
});
