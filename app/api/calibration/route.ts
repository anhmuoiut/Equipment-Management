import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { createSubEquipment, listSubEquipment, SUB_EQUIPMENT_LIST } from '@/lib/services/calibration';
import { parseListParams } from '@/lib/services/core/listQuery';
import { defined, parseBody, readJson } from '@/lib/services/core/validate';
import { createSubSchema } from './schema';

/**
 * Danh sách Calibration: sub-equipment kèm lần hiệu chuẩn mới nhất và Calibration Status — mọi nhóm. MỘT trang: `data` = các dòng,
 * `meta` = { total, page, pageSize }. Tham số như /api/equipment (thêm quick = overdue | due_soon | attention).
 */
export const GET = withAuth(async (req, { requestId }) => {
  const { rows, ...meta } = await listSubEquipment(parseListParams(new URL(req.url).searchParams, SUB_EQUIPMENT_LIST));
  return ok(rows, requestId, meta);
});

/** Thêm sub-equipment — Admin, User. */
export const POST = withAuth(async (req, { requestId, profile }) =>
  ok(await createSubEquipment(defined(parseBody(createSubSchema, await readJson(req))), profile.id), requestId),
{ role: EDITORS });
