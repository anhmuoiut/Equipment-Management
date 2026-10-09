import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getCaller } from '@/lib/auth/session';
import { supabaseAuthClient } from '@/lib/supabase/server';

/**
 * Nơi layout của server gửi một phiên còn hình thức hợp lệ nhưng không còn được phép dùng
 * (tài khoản bị khóa, hồ sơ không còn). Xóa cookie rồi mới tới /login — nếu không, middleware
 * (chỉ nhìn cookie) sẽ đẩy /login thẳng về /.
 *
 * Là GET vì tới đây bằng redirect. Chỉ đăng xuất phiên thật sự không hợp lệ, nên một link ở
 * trang khác không đăng xuất được ai.
 */
export const GET = withAuth(async (req) => {
  const home = new URL('/', req.url);
  const login = new URL('/login', req.url);

  const caller = await getCaller();
  if (!caller) return NextResponse.redirect(login);
  if (caller.profile?.is_active) return NextResponse.redirect(home);

  const auth = await supabaseAuthClient();
  await auth.auth.signOut({ scope: 'local' });
  const response = NextResponse.redirect(login);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}, { allowAnonymous: true });
