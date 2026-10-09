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
