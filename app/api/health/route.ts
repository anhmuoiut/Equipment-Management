import { withAuth, ok } from '@/lib/auth/withAuth';
import { mapRpcError } from '@/lib/errors';
import { db } from '@/lib/services/core/db';

/**
 * Endpoint KHÔNG xác thực duy nhất của hệ thống. Không trả thông tin gì (chỉ ok + giờ máy chủ).
 * Dùng cho keepalive chống Supabase pause (.github/workflows/keepalive.yml) nên PHẢI chạm database: Supabase chỉ tính
 * hoạt động của database / API, không tính một lần gọi chỉ tới Vercel. Một lần đọc 1 dòng của bảng types; lỗi thì trả 500
 * (workflow báo đỏ). Tối đa một lần đọc mỗi phút cho mỗi instance, nên gọi dồn dập không tạo thêm tải cho database.
 */
export const dynamic = 'force-dynamic';

const CHECK_EVERY_MS = 60_000;
let lastCheckedAt = 0;

export const GET = withAuth(
  async (_req, { requestId }) => {
    if (Date.now() - lastCheckedAt >= CHECK_EVERY_MS) {
      const { error } = await db().from('types').select('id').limit(1);
      if (error) throw mapRpcError(error);
      lastCheckedAt = Date.now();
    }
    return ok({ ok: true, ts: new Date().toISOString() }, requestId);
  },
  { allowAnonymous: true },
);
