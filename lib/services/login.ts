import 'server-only';
import { supabaseAuthClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { normalizeUsername, usernameToEmail } from '@/lib/auth/username';
import { getProfileIdentity } from '@/lib/services/profile';

// Giới hạn mỗi instance, bổ sung cho rate limit của Supabase Auth. Không phải bộ giới hạn chung toàn hệ thống.
const attempts = new Map<string, { count: number; expires: number }>();
function limitAttempts(username: string) {
  const now = Date.now();
  const previous = attempts.get(username);
  if (!previous || previous.expires <= now) {
    if (attempts.size >= 2000) attempts.delete(attempts.keys().next().value!);
    attempts.set(username, { count: 1, expires: now + 60_000 });
  } else {
    previous.count++;
    if (previous.count > 10) throw new AppError('LOGIN_RATE_LIMITED');
  }
}

/**
 * Đăng nhập bằng username: server đổi thành email nội bộ rồi nhờ Supabase Auth kiểm tra mật khẩu.
 * Quyền vào app luôn dựa vào user_profiles (phải có dòng và is_active), không chỉ vào việc mật khẩu đúng.
 * Không bao giờ gửi email, khóa hay token ra ngoài trong response.
 */
export async function loginWithUsername(input: { username?: unknown; password?: unknown }) {
  const username = normalizeUsername(input.username);
  if (!username || typeof input.password !== 'string' ||
      !input.password || input.password.length > 256) throw new AppError('INVALID_CREDENTIALS');
  limitAttempts(username);

  const auth = await supabaseAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email: usernameToEmail(username), password: input.password });
  if (error || !data.user) {
    if (error?.status === 429 || error?.code === 'over_request_rate_limit') throw new AppError('LOGIN_RATE_LIMITED');
    // Tài khoản bị khóa (ban_duration) — Supabase từ chối cả khi mật khẩu đúng.
    if (error?.code === 'user_banned') throw new AppError('USER_INACTIVE');
    throw new AppError('INVALID_CREDENTIALS');
  }

  const profile = await getProfileIdentity(data.user.id);
  if (!profile || !profile.is_active) {
    await auth.auth.signOut({ scope: 'local' });
    // Không có hồ sơ = user Auth không thuộc ứng dụng này: không lộ gì thêm.
    throw new AppError(profile ? 'USER_INACTIVE' : 'INVALID_CREDENTIALS');
  }
  attempts.delete(username);
}
