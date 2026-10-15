/**
 * Danh sách đã tải (stale-while-revalidate): quay lại một trang thì hiện ngay danh sách lần trước trong lúc tải bản mới
 * (useFetch `{ cache: true }`, dùng cho danh sách của module). CHỈ trong bộ nhớ của tab — không lưu ở đâu khác — và bị xóa khi
 * đăng nhập / đăng xuất (api.ts), vì đăng xuất → đăng nhập bằng tài khoản khác là chuyển trang mềm, bộ nhớ vẫn còn.
 */
const store = new Map<string, unknown>();

export const listCache = {
  get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
  set: (key: string, value: unknown): void => { store.set(key, value); },
  clear: (): void => { store.clear(); },
};

/**
 * Từng TRANG của danh sách phân trang (Equipment, Calibration, Golden — usePagedList). Khóa là URL đầy đủ nên tự gồm số trang, cỡ trang,
 * chữ tìm, bộ lọc và sắp xếp. Khác `listCache`: mỗi mục nhớ lúc tải; mục còn "tươi" (dưới STALE_MS) được dùng luôn, KHÔNG gọi server —
 * mở lại trang vừa xem, quay về trang trước, đóng modal rồi mở lại đều không tốn request. Mục cũ hơn vẫn hiện ngay rồi tải lại ngầm.
 *
 * Xóa sạch khi: đăng nhập / đăng xuất (như listCache) và SAU MỌI LẦN GHI của người dùng này (api.ts) — một Swap, Move, Check-out, sửa hay
 * Import có thể đổi dòng nào cũng được ở trang nào cũng được, nên không giữ trang nào qua lần ghi. Thay đổi của người khác hiện chậm nhất
 * STALE_MS sau (hoặc khi bấm tải lại). Bộ nhớ chỉ ở tab này, theo tài khoản đang đăng nhập; giữ tối đa MAX_ENTRIES trang.
 */
export const STALE_MS = 30_000;
const MAX_ENTRIES = 60;

export type PagedMeta = { total: number; page: number; pageSize: number };
export type PagedEntry = { rows: unknown[]; meta: PagedMeta; at: number };

const pages = new Map<string, PagedEntry>();
/** Tăng mỗi lần xóa: một phản hồi đến SAU lần xóa nhưng được hỏi TRƯỚC nó (dữ liệu trước lần ghi) không được nhớ lại. */
let epoch = 0;

export const pagedCache = {
  get: (key: string): PagedEntry | undefined => pages.get(key),
  set: (key: string, rows: unknown[], meta: PagedMeta): void => {
    pages.delete(key); // đưa lên cuối thứ tự (mục dùng gần nhất)
    pages.set(key, { rows, meta, at: Date.now() });
    while (pages.size > MAX_ENTRIES) pages.delete(pages.keys().next().value as string);
  },
  /** Mục còn tươi: dùng luôn, không cần hỏi lại server. */
  fresh: (entry: PagedEntry | undefined): entry is PagedEntry => !!entry && Date.now() - entry.at < STALE_MS,
  epoch: (): number => epoch,
  clear: (): void => { pages.clear(); epoch++; },
};
