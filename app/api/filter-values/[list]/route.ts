import { withAuth, ok } from '@/lib/auth/withAuth';
import { filterValues, parseFilterList } from '@/lib/services/listFilters';

/** Giá trị cho các bộ lọc cột lấy từ chính dữ liệu (serial của cha / tester, part number và origin của golden board) — mọi nhóm. */
export const GET = withAuth(async (_req, { requestId, params }) => ok(await filterValues(parseFilterList(params.list)), requestId));
