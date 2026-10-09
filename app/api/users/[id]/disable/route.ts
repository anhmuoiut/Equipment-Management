import { withAuth, ok } from '@/lib/auth/withAuth';
import { ADMINS } from '@/lib/permissions';
import { setUserActive } from '@/lib/services/users';
import { assertUuid } from '@/lib/services/core/validate';

/** Khóa tài khoản (không xóa). */
export const POST = withAuth(async (_req, { requestId, profile, params }) =>
  ok(await setUserActive(assertUuid(params.id), false, profile.id), requestId), { role: ADMINS });
