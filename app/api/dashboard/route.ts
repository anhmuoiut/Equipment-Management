import { withAuth, ok } from '@/lib/auth/withAuth';
import { getDashboard, recentActivities } from '@/lib/services/dashboard';

/**
 * Số liệu Dashboard kèm trang đầu của "Thay đổi gần đây" (không lọc, 50 dòng — đúng như `/api/dashboard/activities?limit=50`):
 * mở Dashboard là MỘT request thay vì hai. Đổi bộ lọc / "Xem thêm" vẫn gọi `/api/dashboard/activities`.
 */
export const GET = withAuth(async (_req, { requestId, profile }) => {
  const [dashboard, activities] = await Promise.all([getDashboard(), recentActivities(profile.role, { limit: 50 })]);
  return ok({ ...dashboard, activities }, requestId);
});
