import 'server-only';

/**
 * Người đang đăng nhập tự sửa thông tin / đổi mật khẩu của chính mình
 * (khác lib/services/users.ts — admin quản lý tài khoản người khác).
 */
import { db, appWrite } from './core/db';
import { supabaseStatelessAuthClient } from '@/lib/supabase/server';
import { AppError, mapRpcError } from '@/lib/errors';
import { usernameToEmail } from '@/lib/auth/username';

/**
 * Đổi mật khẩu của chính mình: nhập đúng mật khẩu hiện tại (mật khẩu tạm cũng là "mật khẩu hiện tại"),
 * đặt mật khẩu mới ở Supabase Auth rồi tắt cờ must_change_password. Phiên đang đăng nhập giữ nguyên.
 * Không ghi lịch sử (không phải thao tác của Admin) — database tự bỏ qua dòng này.
 */
export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const { data: account, error } = await db().from('user_profiles').select('username').eq('id', userId).maybeSingle();
  if (error) throw new AppError('SERVER_ERROR');
  if (!account) throw new AppError('UNAUTHORIZED');

  // Kiểm tra bằng client không giữ phiên, để không đụng cookie đang đăng nhập.
  const { error: verifyError } = await supabaseStatelessAuthClient().auth.signInWithPassword({
    email: usernameToEmail((account as { username: string }).username), password: currentPassword,
  });
  if (verifyError) {
    if (verifyError.status === 429 || verifyError.code === 'over_request_rate_limit') throw new AppError('LOGIN_RATE_LIMITED');
    throw new AppError('CURRENT_PASSWORD_INCORRECT');
  }
  if (newPassword === currentPassword) {
    throw new AppError('VALIDATION_ERROR', { fields: { new_password: 'same_as_current' } });
  }

  const { error: updErr } = await db().auth.admin.updateUserById(userId, { password: newPassword });
  if (updErr) throw new AppError('SERVER_ERROR', {}, { stage: 'set_password', auth: updErr.message });
  await appWrite('user_profiles', 'update', userId, { must_change_password: false }, userId);
}

export async function getOwnAccountDetails(userId: string) {
  const { data, error } = await db().from('user_profiles')
    .select('id, full_name, username, employee_id, department_id, role')
    .eq('id', userId).maybeSingle();
  if (error) throw mapRpcError(error);
  if (!data) throw new AppError('UNAUTHORIZED');
  return data;
}

export type OwnProfilePatch = { full_name: string; employee_id: string | null; department_id: string | null };

/** Chỉ họ tên, mã nhân viên, phòng ban. Username và nhóm quyền do Admin quản lý. */
export async function updateOwnProfile(userId: string, patch: OwnProfilePatch) {
  return appWrite('user_profiles', 'update', userId, patch, userId);
}
