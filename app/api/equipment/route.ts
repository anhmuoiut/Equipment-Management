import { withAuth, ok } from '@/lib/auth/withAuth';
import { EDITORS } from '@/lib/permissions';
import { createEquipment, listEquipment } from '@/lib/services/equipment';
import { parseBody, readJson, defined } from '@/lib/services/core/validate';
import { createSchema } from './schema';

/** Masterlist thiết bị — mọi nhóm. */
export const GET = withAuth(async (_req, { requestId }) => ok(await listEquipment(), requestId));

/** Thêm thiết bị — Admin, User. Serial trùng chỉ cảnh báo: màn hình gọi /api/assets/serial-matches trước khi lưu. */
export const POST = withAuth(async (req, { requestId, profile }) => {
  const body = defined(parseBody(createSchema, await readJson(req)));
  return ok(await createEquipment(body, profile.id), requestId);
}, { role: EDITORS });
