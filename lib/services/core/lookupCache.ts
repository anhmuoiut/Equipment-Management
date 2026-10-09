import 'server-only';

/**
 * Bộ nhớ đệm của dữ liệu gốc dùng chung (lookups.ts). Trước đây MỖI request API đọc lại 9 bảng (Configuration + tên
 * người dùng) chỉ để đổi id → chữ hiển thị — thường là phần lớn thời gian của một request.
 *
 *  - Đọc gộp: nhiều request cùng lúc dùng chung MỘT lần đọc đang chạy.
 *  - Hết hạn sau TTL: sửa dữ liệu gốc từ bên ngoài ứng dụng (SQL editor, script) hiện ra chậm nhất TTL giây.
 *  - Mọi lần ghi của ứng dụng đi qua appWrite (db.ts) → `invalidateLookups()` ngay trong tiến trình; một lần đọc đã
 *    bắt đầu TRƯỚC lần ghi không bao giờ được giữ lại cho request sau (số thế hệ `generation`).
 *  - Lỗi không được nhớ: lần gọi sau đọc lại.
 *
 * File riêng, không import gì từ module khác: db.ts (ghi) và lookups.ts (đọc) cùng dùng mà không vòng phụ thuộc.
 */
const TTL_MS = 60_000;

type Entry<T> = { generation: number; at: number; value: Promise<T> };

let generation = 0;
let entry: Entry<unknown> | null = null;

export function cachedLookups<T>(read: () => Promise<T>): Promise<T> {
  if (entry && entry.generation === generation && Date.now() - entry.at < TTL_MS) return entry.value as Promise<T>;
  const mine: Entry<T> = { generation, at: Date.now(), value: undefined as unknown as Promise<T> };
  mine.value = read().catch((error: unknown) => {
    if (entry === mine) entry = null;
    throw error;
  });
  entry = mine;
  return mine.value;
}

/** Sau mỗi lần ghi vào một bảng dữ liệu gốc (hoặc user_profiles): lần đọc kế tiếp lấy dữ liệu mới. */
export function invalidateLookups(): void {
  generation++;
  entry = null;
}

/** Bảng có trong lookups: ghi vào đây thì bộ nhớ đệm hết giá trị. */
export const LOOKUP_TABLES: ReadonlySet<string> = new Set([
  'part_numbers', 'locations', 'types', 'type_groups', 'levels', 'departments', 'calibration_vendors', 'tags', 'user_profiles',
]);
