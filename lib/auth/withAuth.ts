import 'server-only';

/**
 * withAuth — mọi API route đều phải đi qua đây và khai báo nhóm quyền nó cần.
 *
 *   export const POST = withAuth(handler, { role: EDITORS });
 *
 * service_role bỏ qua RLS, nên đây là chỗ duy nhất quyết định quyền.
 * Kiểm tra định kỳ: grep -rLn "withAuth" app/api --include=route.ts
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AppError, type ErrorCode } from '@/lib/errors';
import { getCaller } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runInAction } from '@/lib/services/core/actionContext';
import type { Role, UserProfile } from '@/lib/permissions';

export type AuthContext = {
  requestId: string;
  profile: UserProfile;
  params: Record<string, string>;
};

type Options = {
  /** Nhóm được phép. Mặc định: mọi nhóm đã đăng nhập. */
  role?: readonly Role[];
  /** Chỉ cho đăng nhập / đăng xuất / health. */
  allowAnonymous?: true;
  /** Vẫn gọi được khi đang bị bắt đổi mật khẩu (/api/me, /api/me/password). */
  allowPendingPasswordChange?: true;
};

type Handler = (req: NextRequest, ctx: AuthContext) => Promise<NextResponse> | NextResponse;

export function ok<T>(data: T, requestId: string, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, data, meta: { ...meta, request_id: requestId } });
}

function fail(err: AppError, requestId: string) {
  // Chỉ gửi details an toàn của lỗi 4xx (lỗi theo trường…); `diagnostic` không bao giờ rời server.
  const details = err.status >= 500 ? {} : err.details;
  return NextResponse.json(
    { success: false, error: { code: err.code, message: err.message, details, request_id: requestId } },
    { status: err.status },
  );
}

async function logError(requestId: string, route: string, userId: string | null, code: ErrorCode, message: string, stack?: string) {
  try {
    await supabaseAdmin().from('error_log').insert({
      request_id: requestId, route, user_id: userId, error_code: code,
      message: message.slice(0, 2000), stack: stack?.slice(0, 8000) ?? null,
    });
  } catch {
    console.error(`[${requestId}] could not write error_log`);
  }
}

export function withAuth(handler: Handler, options: Options = {}) {
  // Mỗi request API là MỘT thao tác của người dùng: sinh một action_id, mọi lần ghi database trong request dùng chung nó
  // (lib/services/core/actionContext.ts) — Recent changes nhờ đó gộp các dòng nhật ký của một thao tác thành một dòng.
  return (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => runInAction(async () => {
    const requestId = `req_${crypto.randomUUID()}`;
    const route = `${req.method} ${new URL(req.url).pathname}`;
    let userId: string | null = null;

    try {
      const params = (await routeCtx?.params) ?? {};
      if (options.allowAnonymous) {
        return await handler(req, { requestId, params, profile: null as unknown as UserProfile });
      }

      const caller = await getCaller();
      if (!caller) throw new AppError('UNAUTHORIZED');
      userId = caller.userId;

      const { profile } = caller;
      if (!profile) throw new AppError('UNAUTHORIZED');
      if (!profile.is_active) throw new AppError('USER_INACTIVE');
      if (profile.must_change_password && !options.allowPendingPasswordChange) throw new AppError('PASSWORD_CHANGE_REQUIRED');
      if (options.role && !options.role.includes(profile.role)) throw new AppError('FORBIDDEN', { required_role: options.role });

      return await handler(req, { requestId, profile, params });
    } catch (e) {
      if (e instanceof AppError) {
        if (e.status >= 500) {
          // In ra terminal để thấy nguyên nhân ngay khi chạy `npm run dev`.
          console.error(`[${requestId}] ${route} ${e.code}`, e.diagnostic);
          await logError(requestId, route, userId, e.code, e.message, JSON.stringify(e.diagnostic));
        } else if (process.env.NODE_ENV !== 'production') {
          // Lỗi nghiệp vụ (4xx) không vào error_log — khi dev vẫn thấy lý do ngay trong terminal.
          console.warn(`[${requestId}] ${route} → ${e.status} ${e.code}`, { ...e.details, ...e.diagnostic });
        }
        return fail(e, requestId);
      }
      const err = e as Error;
      console.error(`[${requestId}] ${route}`, err);
      await logError(requestId, route, userId, 'SERVER_ERROR', err?.message ?? 'unknown', err?.stack);
      return fail(new AppError('SERVER_ERROR'), requestId);
    }
  });
}
