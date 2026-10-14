import 'server-only';

/**
 * MỘT thao tác của người dùng = MỘT action_id.
 *
 * `withAuth` sinh một id cho mỗi request API (đúng một thao tác của người dùng) và chạy cả handler trong ngữ cảnh này; `appWrite` và
 * `rpc` (hàm ghi dữ liệu) đọc id ở đây và truyền xuống database (`p_action_id`), nên MỌI dòng nhật ký do thao tác đó ghi ra — dù qua nhiều
 * lần gọi database (sửa form = Move + sửa trường + đổi vị trí…) — dùng chung một id mà không phải đưa tham số qua từng hàm dịch vụ.
 * Ngoài `withAuth` (script, test) không có id: database tự sinh một id cho mỗi lần gọi.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<{ actionId: string }>();

export function runInAction<T>(fn: () => T): T {
  return store.run({ actionId: crypto.randomUUID() }, fn);
}

export function currentActionId(): string | undefined {
  return store.getStore()?.actionId;
}
