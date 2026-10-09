import 'server-only';

/**
 * Giữ kết nối tới Supabase mở lâu hơn giữa hai request.
 *
 * Mặc định Node đóng kết nối rảnh sau ~4 giây, nên người dùng dừng vài giây giữa hai lần bấm là request kế tiếp phải bắt tay TLS
 * lại — qua proxy công ty mất thêm ~0,35 s cho MỖI kết nối, và request thường mở vài kết nối song song (xác thực + hồ sơ + truy
 * vấn dữ liệu): đo thật, 3 request song song sau 6 giây rảnh mất ~420 ms, giữ kết nối thì ~255 ms.
 *
 * `undici` là bộ máy bên dưới `fetch` của Node (cùng bản chính 7.x), supabase-js dùng nó nên đổi ở một chỗ này là đủ.
 * Nếu Supabase gửi gợi ý `Keep-Alive: timeout=N` thì gợi ý đó được ưu tiên, undici tự trừ biên an toàn trước khi dùng lại một kết nối.
 */
import { Agent, setGlobalDispatcher } from 'undici';

export const KEEP_ALIVE_MS = 30_000;
const KEEP_ALIVE_MAX_MS = 120_000;

export function keepConnectionsWarm(): void {
  setGlobalDispatcher(new Agent({ keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: KEEP_ALIVE_MAX_MS }));
}
