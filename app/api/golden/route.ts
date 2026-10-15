import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { createGolden, GOLDEN_LIST, listGolden } from '@/lib/services/golden';
import { parseListParams } from '@/lib/services/core/listQuery';
import { defined, parseBody, readJson } from '@/lib/services/core/validate';
import { createSchema } from './schema';

/** Danh sách Golden board — MỘT trang: `data` = các dòng, `meta` = { total, page, pageSize }. Tham số như /api/equipment. */
export const GET = withAuth(async (req, { requestId }) => {
  const { rows, ...meta } = await listGolden(parseListParams(new URL(req.url).searchParams, GOLDEN_LIST));
  return ok(rows, requestId, meta);
});

export const POST = withAuth(async (req, { requestId, profile }) =>
  ok(await createGolden(defined(parseBody(createSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
