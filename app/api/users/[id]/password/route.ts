import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { resetUserPassword } from '@/lib/services/users';
import { assertUuid } from '@/lib/services/core/validate';

/** Admin đặt lại mật khẩu: không nhận mật khẩu, trả { user, temp_password } một lần. */
export const POST = withAuth(async (_req, { requestId, profile, params }) => {
  const response = ok(await resetUserPassword(assertUuid(params.id), profile.id), requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}, { role: ADMINS });
