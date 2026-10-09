import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { createSubEquipment, listSubEquipment } from '@/lib/services/calibration';
import { defined, parseBody, readJson } from '@/lib/services/core/validate';
import { createSubSchema } from './schema';

/** Danh sách Calibration: sub-equipment kèm lần hiệu chuẩn mới nhất và Calibration Status — mọi nhóm. */
export const GET = withAuth(async (_req, { requestId }) => ok(await listSubEquipment(), requestId));

/** Thêm sub-equipment — Admin, User. */
export const POST = withAuth(async (req, { requestId, profile }) =>
  ok(await createSubEquipment(defined(parseBody(createSubSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
