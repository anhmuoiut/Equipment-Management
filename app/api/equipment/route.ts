import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { createEquipment, EQUIPMENT_LIST, listEquipment } from '@/lib/services/equipment';
import { parseListParams } from '@/lib/services/core/listQuery';
import { parseBody, readJson, defined } from '@/lib/services/core/validate';
import { createSchema } from './schema';

/**
 * Masterlist thiết bị — mọi nhóm. MỘT trang: `data` = các dòng của trang, `meta` = { total, page, pageSize }.
 * Tham số: page, pageSize (25 | 50 | 100 | all), q, sort, dir, quick, f.<cột>, qe — xem lib/services/core/listQuery.ts.
 */
export const GET = withAuth(async (req, { requestId }) => {
  const { rows, ...meta } = await listEquipment(parseListParams(new URL(req.url).searchParams, EQUIPMENT_LIST));
  return ok(rows, requestId, meta);
});

/** Thêm thiết bị — Admin, User. Serial trùng chỉ cảnh báo: màn hình gọi /api/assets/serial-matches trước khi lưu. */
export const POST = withAuth(async (req, { requestId, profile }) => {
  const body = defined(parseBody(createSchema, await readJson(req)));
  return ok(await createEquipment(body, profile.id), requestId);
}, { role: EDITORS });
