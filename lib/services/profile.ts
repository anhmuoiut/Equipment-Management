import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors';
import type { Role } from '@/lib/permissions';

export type ProfileIdentity = {
  username: string; full_name: string; role: Role; is_active: boolean; must_change_password: boolean;
};

/** Gọi chỉ với id lấy từ phiên đăng nhập đã xác thực ở server. */
export async function getProfileIdentity(userId: string): Promise<ProfileIdentity | null> {
  const { data, error } = await supabaseAdmin().from('user_profiles')
    .select('username, full_name, role, is_active, must_change_password')
    .eq('id', userId).maybeSingle();
  if (error) throw new AppError('SERVER_ERROR', {}, { stage: 'load_profile', pg: error.message });
  return data as ProfileIdentity | null;
}
