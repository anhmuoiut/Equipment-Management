import 'server-only';

/**
 * Bản cho trang của withAuth: cùng các bước kiểm tra phiên, nhưng không đạt
 * thì chuyển trang thay vì trả 401/403. Nhớ theo từng request (React cache).
 *
 * Phiên không còn hợp lệ (tài khoản bị khóa, hồ sơ không còn) đi qua
 * /api/auth/session-ended để xóa cookie rồi mới về /login.
 */
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getCaller } from '@/lib/auth/session';
import type { Role } from '@/lib/permissions';

export type PageViewer = {
  userId: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
};

export const SESSION_ENDED_PATH = '/api/auth/session-ended';

export const requirePageViewer = cache(async (): Promise<PageViewer> => {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const { profile } = caller;
  if (!profile || !profile.is_active) redirect(SESSION_ENDED_PATH);
  return {
    userId: caller.userId,
    username: profile.username,
    fullName: profile.full_name,
    role: profile.role,
    mustChangePassword: profile.must_change_password,
  };
});

/** Trang chỉ Admin (Configuration, User Management): nhóm khác về Dashboard. */
export async function requireAdminPage(): Promise<PageViewer> {
  const viewer = await requirePageViewer();
  if (viewer.role !== 'admin') redirect('/?denied=1');
  return viewer;
}
