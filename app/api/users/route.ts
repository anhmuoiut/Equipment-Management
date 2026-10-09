import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { createUser, listUsers } from '@/lib/services/users';
import { parseBody, readJson, z, optText, optId, reqText } from '@/lib/services/core/validate';

export const GET = withAuth(async (_req, { requestId }) => ok(await listUsers(), requestId), { role: ADMINS });

/**
 * Admin thêm tài khoản. Không nhận mật khẩu: hệ thống sinh mật khẩu tạm, trả về MỘT lần trong response
 * ({ user, temp_password }); người dùng phải đổi ở lần đăng nhập đầu.
 */
export const POST = withAuth(async (req, { requestId, profile }) => {
  const body = parseBody(z.object({
    username: reqText(64),
    full_name: reqText(200),
    employee_id: optText(100),
    department_id: optId,
    role: z.enum(['admin', 'user', 'readonly']),
  }).strict(), await readJson(req));
  const response = ok(await createUser(body, profile.id), requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}, { role: ADMINS });
