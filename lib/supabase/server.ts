import 'server-only';

/**
 * Client dùng publishable key, CHỈ để xác thực. Không bao giờ dùng để đọc/ghi bảng
 * nghiệp vụ — RLS deny-all sẽ chặn.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const publicKey = () => (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;

/** Có cookie: đăng nhập / đăng xuất / lấy người đang gọi. */
export async function supabaseAuthClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    publicKey(),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component không set được cookie — middleware lo phần refresh.
          }
        },
      },
    },
  );
}

/**
 * Không cookie, không giữ phiên: chỉ để kiểm tra một mật khẩu (ví dụ "mật khẩu hiện tại" khi đổi
 * mật khẩu) mà không đụng tới phiên đang đăng nhập.
 */
export function supabaseStatelessAuthClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, publicKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
