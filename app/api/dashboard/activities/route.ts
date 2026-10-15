import { withAuth, ok } from '@/lib/auth/withAuth';
import { recentActivities } from '@/lib/services/dashboard';
import { UUID_RE } from '@/lib/services/core/validate';
import type { HistoryModule } from '@/lib/types';

const MODULES: HistoryModule[] = ['equipment', 'sub_equipment', 'golden_board', 'configuration', 'user'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Thay đổi gần đây — lọc theo module, người thay đổi, khoảng thời gian, tìm theo tên / serial (`q`). Phân trang ở database:
 * `limit` thao tác một trang (mặc định 50, tối đa 100), `offset` = số thao tác đã có (trang sau của CÙNG bộ lọc).
 */
export const GET = withAuth(async (req, { requestId, profile }) => {
  const sp = new URL(req.url).searchParams;
  const moduleName = sp.get('module') as HistoryModule | null;
  const userId = sp.get('user');
  const from = sp.get('from');
  const to = sp.get('to');
  return ok(await recentActivities(profile.role, {
    module: moduleName && MODULES.includes(moduleName) ? moduleName : undefined,
    userId: userId && UUID_RE.test(userId) ? userId : undefined,
    search: sp.get('q')?.trim().slice(0, 100) || undefined,
    from: from && DATE.test(from) ? `${from}T00:00:00+07:00` : undefined,
    to: to && DATE.test(to) ? `${to}T23:59:59+07:00` : undefined,
    limit: Number(sp.get('limit')) || 50,
    offset: Number(sp.get('offset')) || 0,
  }), requestId);
});
