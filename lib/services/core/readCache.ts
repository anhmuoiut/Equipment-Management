import 'server-only';

/**
 * Bộ nhớ đệm ngắn hạn cho dữ liệu đọc dùng chung của mọi người dùng (ví dụ các giá trị của bộ lọc cột). Cùng cách làm với lookupCache.ts:
 *  - đọc gộp: nhiều request cùng lúc dùng chung MỘT lần đọc đang chạy;
 *  - hết hạn sau `ttlMs`: thay đổi từ instance khác (hoặc từ ngoài ứng dụng) hiện ra chậm nhất chừng đó;
 *  - mọi lần ghi của ứng dụng (db.ts) gọi `invalidateReads()` → lần đọc kế tiếp lấy dữ liệu mới; một lần đọc đã bắt đầu TRƯỚC lần ghi
 *    không bao giờ được giữ lại cho request sau;
 *  - lỗi không được nhớ.
 * Chỉ dùng cho dữ liệu giống nhau với mọi người dùng — không bao giờ cho dữ liệu theo quyền / theo tài khoản.
 */
let generation = 0;

type Entry<T> = { generation: number; at: number; value: Promise<T> };

export function createReadCache<T>(ttlMs: number) {
  let entry: Entry<T> | null = null;
  return {
    get(read: () => Promise<T>): Promise<T> {
      if (entry && entry.generation === generation && Date.now() - entry.at < ttlMs) return entry.value;
      const mine: Entry<T> = { generation, at: Date.now(), value: undefined as unknown as Promise<T> };
      mine.value = read().catch((error: unknown) => {
        if (entry === mine) entry = null;
        throw error;
      });
      entry = mine;
      return mine.value;
    },
    clear(): void { entry = null; },
  };
}

/** Sau mỗi lần ghi của ứng dụng: mọi bộ nhớ đệm đọc đều hết giá trị. */
export function invalidateReads(): void {
  generation++;
}
