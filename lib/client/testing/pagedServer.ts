/**
 * Server giả cho bài test của danh sách phân trang: nhận URL `/api/<module>?page=&pageSize=&q=&sort=&dir=&quick=&f.<cột>=` và trả
 * `{ data, meta: { total, page, pageSize } }` như route thật (tìm / lọc / sắp xếp / cắt trang trên `rows`), kẹp trang vượt quá về trang cuối.
 * Cách lọc của từng module do bài test khai báo — bài test này kiểm tra giao diện gửi đúng tham số và vẽ đúng phản hồi; kết quả lọc thật
 * của database được kiểm tra riêng (listQuery.test.ts, và các view trên PGlite).
 */
export type PagedSpec<R> = {
  /** Chữ tìm có khớp dòng không (mặc định: mọi giá trị chuỗi của dòng, không phân biệt hoa thường). */
  search?: (row: R, q: string) => boolean;
  quick?: Record<string, (row: R) => boolean>;
  filters?: Record<string, (row: R, value: string) => boolean>;
  sort?: Record<string, (row: R) => string | number | null>;
};

export function pagedResponse<R extends { id: string }>(rows: R[], url: string, spec: PagedSpec<R> = {}) {
  const [, query = ''] = url.split('?');
  const sp = new URLSearchParams(query);
  let out = rows;

  const q = (sp.get('q') ?? '').toLowerCase();
  if (q) out = out.filter((r) => (spec.search ? spec.search(r, q) : Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))));
  const quick = sp.get('quick');
  if (quick && spec.quick?.[quick]) out = out.filter(spec.quick[quick]!);
  for (const [key, value] of sp.entries()) {
    if (key.startsWith('f.') && spec.filters?.[key.slice(2)]) out = out.filter((r) => spec.filters![key.slice(2)]!(r, value));
  }
  const sortKey = sp.get('sort');
  const sortBy = sortKey ? spec.sort?.[sortKey] : undefined;
  if (sortBy) {
    const sign = sp.get('dir') === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = sortBy(a), y = sortBy(b);
      if (x === y) return a.id.localeCompare(b.id);
      if (x === null) return sign;
      if (y === null) return -sign;
      return (x < y ? -1 : 1) * sign;
    });
  }

  const total = out.length;
  const pageSize = sp.get('pageSize') === 'all' ? Math.max(total, 1) : Number(sp.get('pageSize')) || 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(sp.get('page')) || 1), pages);
  return { data: out.slice((page - 1) * pageSize, page * pageSize), meta: { total, page, pageSize } };
}
