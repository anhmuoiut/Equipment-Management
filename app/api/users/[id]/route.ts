import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { getUser, updateUser } from '@/lib/services/users';
import { assertUuid, defined, parseBody, readJson, z, optText, optId, reqText } from '@/lib/services/core/validate';

export const GET = withAuth(async (_req, { requestId, params }) =>
  ok(await getUser(assertUuid(params.id)), requestId), { role: ADMINS });

/** Sửa họ tên, mã nhân viên, phòng ban, nhóm quyền. Username không đổi sau khi tạo (key lạ bị từ chối). */
export const PUT = withAuth(async (req, { requestId, profile, params }) => {
  const body = defined(parseBody(z.object({
    full_name: reqText(200),
    employee_id: optText(100),
    department_id: optId,
    role: z.enum(['admin', 'user', 'readonly']),
  }).partial().strict(), await readJson(req)));
  return ok(await updateUser(assertUuid(params.id), body, profile.id), requestId);
}, { role: ADMINS });
