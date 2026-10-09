import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { getGolden, updateGolden } from '@/lib/services/golden';
import { assertUuid, defined, parseBody, readJson } from '@/lib/services/core/validate';
import { updateSchema } from '../schema';

export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await getGolden(assertUuid(params.id)), requestId));

/** Sửa golden board. Xóa: DELETE /api/assets/golden_board/{id}. */
export const PUT = withAuth(async (req, { requestId, profile, params }) =>
  ok(await updateGolden(assertUuid(params.id), defined(parseBody(updateSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
