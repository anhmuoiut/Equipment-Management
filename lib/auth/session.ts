import 'server-only';

/**
 * Một chỗ duy nhất trả lời "ai đang gọi": phiên Supabase Auth (cookie do @supabase/ssr quản) + hồ sơ trong user_profiles.
 * Dùng bởi withAuth cho API và bởi layout cho chuyển trang, để hai nơi không bao giờ lệch nhau.
 *
 * `getUser()` hỏi thẳng Supabase (không chỉ giải mã token), nên tài khoản bị khóa (ban_duration) mất phiên ngay. Quyền vào
 * app vẫn luôn dựa vào user_profiles (is_active, role…) ở MỌI request, không bao giờ chỉ dựa vào token hợp lệ.
 *
 * Tốc độ: xác thực (getUser) và đọc hồ sơ là hai vòng mạng tới Supabase; chạy lần lượt tốn gấp đôi. Id lấy từ token trong cookie
 * (CHƯA xác thực — chỉ để đọc hồ sơ SONG SONG với getUser). Hồ sơ đó chỉ được dùng khi getUser xác nhận đúng id ấy; token giả
 * / id lạ thì kết quả bị bỏ và request bị từ chối như trước.
 */
import { supabaseAuthClient } from '@/lib/supabase/server';
import { getProfileIdentity } from '@/lib/services/profile';
import { UUID_RE } from '@/lib/services/core/validate';
import type { UserProfile } from '@/lib/permissions';

export type Caller = {
  userId: string;
  /** null = phiên hợp lệ nhưng không có hồ sơ trong user_profiles. */
  profile: UserProfile | null;
};

/** `sub` trong token (không kiểm tra chữ ký) — chỉ là gợi ý để đọc hồ sơ sớm. */
function subjectHint(token: string | undefined): string | null {
  try {
    const sub = (JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString()) as { sub?: unknown }).sub;
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

export async function getCaller(): Promise<Caller | null> {
  const auth = await supabaseAuthClient();
  const hint = subjectHint((await auth.auth.getSession()).data.session?.access_token);
  // Lỗi của lần đọc "đoán trước" không được làm hỏng request: có lỗi thật thì đọc lại bên dưới (và báo đúng lỗi).
  const early = hint ? getProfileIdentity(hint).catch(() => undefined) : undefined;
  const { data } = await auth.auth.getUser();
  if (!data.user) return null;

  const userId = data.user.id;
  const guessed = userId === hint ? await early : undefined;
  const identity = guessed !== undefined ? guessed : await getProfileIdentity(userId);
  return { userId, profile: identity ? { id: userId, ...identity } : null };
}
