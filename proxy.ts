import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware chỉ làm hai việc: refresh session cookie và redirect khi chưa
 * đăng nhập. Middleware KHÔNG chứa logic phân quyền — logic đó nằm ở withAuth
 * để chỉ có một nơi duy nhất quyết định quyền.
 *
 * "Logged in" = có phiên Supabase Auth. Middleware không đọc user_profiles (is_active,
 * must_change_password): kiểm tra thật luôn nằm ở withAuth / layout của server, ở mọi request.
 *
 * Tốc độ: middleware chạy ở MỌI lần chuyển trang. getUser() là một vòng mạng tới Supabase (~0.3 s), nên chỉ dùng ở nơi không
 * còn ai kiểm tra sau nó: /login (phiên hỏng phải coi như chưa đăng nhập, không thì /login ↔ / quay vòng) và trang nhãn (không
 * có layout kiểm tra phiên). Mọi trang còn lại nằm dưới layout (app) / tự gọi requirePageViewer — hỏi Supabase thật ở đó — nên
 * ở đây getSession() là đủ: đọc cookie, chỉ gọi mạng khi cần làm mới token hết hạn; phiên không hợp lệ vẫn bị layout chuyển về
 * /login, và dữ liệu luôn đi qua withAuth.
 */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { pathname } = req.nextUrl;
  const isLogin = pathname.startsWith('/login');
  const verifyHere = isLogin || pathname.endsWith('/label');

  const isLoggedIn = verifyHere
    ? !!(await supabase.auth.getUser()).data.user
    : !!(await supabase.auth.getSession()).data.session;

  if (!isLoggedIn && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Public static files under public/ (banner/logo images, etc.) are served
  // at the site root with no auth of their own — if the matcher doesn't
  // exclude them too, an unauthenticated request for one gets redirected to
  // /login and the browser tries to render that HTML as the image, which is
  // exactly the failure mode of a broken image on the login page itself.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico)$).*)'],
};
