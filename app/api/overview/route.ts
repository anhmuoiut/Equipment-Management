import { withAuth, ok } from '@/lib/auth/withAuth';
import { assertOverviewFilter, overviewBoard } from '@/lib/services/overview';

/**
 * Bảng Overview — mọi nhóm, chỉ đọc. `usage` = in_use | not_in_use, `kind` = tester | base | fixture | sub_equipment | golden_board,
 * `q` = serial / part number; bỏ trống cả ba = cả bảng. Lọc chạy trong database.
 */
export const GET = withAuth(async (req, { requestId }) => {
  const sp = new URL(req.url).searchParams;
  const filter = assertOverviewFilter({ usage: sp.get('usage'), kind: sp.get('kind'), q: sp.get('q') });
  return ok(await overviewBoard(filter), requestId);
});
