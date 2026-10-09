import { withAuth, ok } from '@/lib/auth/withAuth';
import { supabaseAuthClient } from '@/lib/supabase/server';

/** Đăng xuất phiên này (không đăng xuất các thiết bị khác của cùng tài khoản). */
export const POST = withAuth(async (_req, { requestId }) => {
  const auth = await supabaseAuthClient();
  await auth.auth.signOut({ scope: 'local' });
  const response = ok({ signed_out: true }, requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}, { allowAnonymous: true });
