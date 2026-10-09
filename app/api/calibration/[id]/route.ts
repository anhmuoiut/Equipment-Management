import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { getSubEquipment, updateSubEquipment } from '@/lib/services/calibration';
import { assertUuid, defined, parseBody, readJson } from '@/lib/services/core/validate';
import { updateSubSchema } from '../schema';

export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await getSubEquipment(assertUuid(params.id)), requestId));

/** Sửa sub-equipment (đổi tester → Move / Detach, đổi vị trí → Đổi vị trí). Xóa: DELETE /api/assets/sub_equipment/{id}. */
export const PUT = withAuth(async (req, { requestId, profile, params }) =>
  ok(await updateSubEquipment(assertUuid(params.id), defined(parseBody(updateSubSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
