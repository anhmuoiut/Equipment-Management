/**
 * Giả truy vấn danh sách của PostgREST cho bài test: `from(view).select(cols, { count: 'exact' }).<bộ lọc>.order().range(a, b)`.
 * Ghi lại mọi lời gọi; `range` cắt đúng đoạn từ `rows` và trả `count` = tổng số dòng (như `Prefer: count=exact`); `range` bắt đầu sau dòng cuối
 * trả PGRST103 (416 Range Not Satisfiable) như PostgREST thật. Bộ lọc KHÔNG được áp dụng lên `rows` — bài test kiểm tra lời gọi, còn
 * kết quả lọc thật được kiểm tra trên PGlite với chính các view.
 */
export type RecordedCall = [method: string, args: unknown[]];

export function fakeListDb(rows: Record<string, unknown>[] = []) {
  const queries: { view: string; calls: RecordedCall[] }[] = [];

  function from(view: string) {
    const query = { view, calls: [] as RecordedCall[] };
    queries.push(query);
    let window: [number, number] | null = null;
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => {
            if (!window) return resolve({ data: rows, error: null, count: rows.length });
            const [a, b] = window;
            if (a > 0 && a >= rows.length) {
              return resolve({ data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable', details: `An offset of ${a} was requested, but there are only ${rows.length} rows.` } });
            }
            return resolve({ data: rows.slice(a, b + 1), error: null, count: rows.length });
          };
        }
        return (...args: unknown[]) => {
          query.calls.push([String(prop), args]);
          if (prop === 'range') window = [args[0] as number, args[1] as number];
          return builder;
        };
      },
    });
    return builder;
  }

  return {
    from,
    queries,
    /** Lời gọi theo tên của lần truy vấn thứ `index` (mặc định cuối cùng). */
    calls: (name: string, index = queries.length - 1) => queries[index]!.calls.filter(([n]) => n === name).map(([, args]) => args),
    last: () => queries[queries.length - 1]!,
  };
}
