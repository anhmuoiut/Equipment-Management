import 'server-only';

/**
 * Module User Management — bảng user_profiles, user_histories. Chỉ Admin.
 * docs/DATABASE_MODIFIED.md mục 8.
 *
 * Tài khoản là người dùng Supabase Auth do Admin tạo; không tự đăng ký, không xóa, chỉ khóa.
 * Đúng bốn thao tác: Thêm, Sửa, Đặt lại mật khẩu, Khóa / Mở khóa. Mật khẩu tạm do hệ thống sinh
 * và chỉ trả về MỘT lần (response của Thêm / Đặt lại) — không lưu ở đâu. Lịch sử (CREATE, UPDATE,
 * ROLE_CHANGE, DISABLE, ENABLE, PASSWORD_RESET) và việc chặn Admin tự khóa / Admin cuối cùng
 * do database làm (trigger write_history, user_admin_guard).
 */
import { appWrite, db, selectAll, selectOne } from './core/db';
import { readHistory } from './core/history';
import { assertActive, auditOf, loadLookups, nameOf, type Lookups } from './core/lookups';
import { AppError } from '@/lib/errors';
import { generateTempPassword } from '@/lib/auth/tempPassword';
import { normalizeUsername, usernameToEmail } from '@/lib/auth/username';
import type { Role } from '@/lib/permissions';
import type { HistoryEntry, UserRow, UserWithTempPassword } from '@/lib/types';

type DbUser = {
  id: string; username: string; full_name: string; employee_id: string | null; department_id: string | null;
  role: Role; is_active: boolean; must_change_password: boolean;
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};

const COLUMNS = 'id, username, full_name, employee_id, department_id, role, is_active, must_change_password, ' +
  'created_at, created_by, updated_at, updated_by';

/** ban_duration của Supabase Auth: ~100 năm = khóa tới khi Admin mở. 'none' = bỏ khóa. */
const BAN_FOREVER = '876000h';

function toRow(u: DbUser, lookups: Lookups): UserRow {
  return { ...u, department: nameOf(lookups.departments, u.department_id), ...auditOf(lookups, u) };
}

export async function listUsers(): Promise<UserRow[]> {
  const [rows, lookups] = await Promise.all([selectAll<DbUser>('user_profiles', COLUMNS), loadLookups()]);
  return rows.map((r) => toRow(r, lookups));
}

export async function getUser(id: string): Promise<UserRow> {
  const [row, lookups] = await Promise.all([load(id), loadLookups()]);
  return toRow(row, lookups);
}

async function load(id: string): Promise<DbUser> {
  const row = await selectOne<DbUser>('user_profiles', id, COLUMNS);
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export type UserCreateInput = {
  username: string; full_name: string; employee_id?: string | null; department_id?: string | null; role: Role;
};

export async function createUser(input: UserCreateInput, actor: string): Promise<UserWithTempPassword> {
  const username = normalizeUsername(input.username);
  if (!username) throw new AppError('VALIDATION_ERROR', { fields: { username: 'invalid' } });
  assertActive((await loadLookups()).departments, input.department_id, 'department_id');

  const { data: taken, error: takenError } = await db().from('user_profiles').select('id').eq('username', username).limit(1);
  if (takenError) throw new AppError('SERVER_ERROR', {}, { stage: 'username_lookup', pg: takenError.message });
  if (taken?.length) throw new AppError('USERNAME_ALREADY_EXISTS');

  // 1) user Supabase Auth với mật khẩu tạm (email nội bộ, không gửi thư)  2) hồ sơ với id trùng id Auth.
  const password = generateTempPassword();
  const created = await db().auth.admin.createUser({ email: usernameToEmail(username), password, email_confirm: true });
  if (created.error || !created.data.user) {
    if (created.error?.code === 'email_exists') throw new AppError('USERNAME_ALREADY_EXISTS');
    throw new AppError('SERVER_ERROR', {}, { stage: 'create_auth_user', auth: created.error?.message });
  }
  const id = created.data.user.id;
  try {
    await appWrite('user_profiles', 'insert', null, {
      id, username, full_name: input.full_name, employee_id: input.employee_id ?? null,
      department_id: input.department_id ?? null, role: input.role, is_active: true, must_change_password: true,
    }, actor);
  } catch (e) {
    // Hồ sơ không ghi được: bỏ user Auth vừa tạo để không để lại tài khoản mồ côi.
    const { error } = await db().auth.admin.deleteUser(id);
    if (error) console.error('createUser: could not remove the orphan auth user', id, error.message);
    if (e instanceof AppError && e.code === 'DUPLICATE_VALUE') throw new AppError('USERNAME_ALREADY_EXISTS');
    throw e;
  }
  return { user: await getUser(id), temp_password: password };
}

/** Sửa: họ tên, mã nhân viên, phòng ban, nhóm quyền. Username không đổi sau khi tạo. */
export type UserUpdateInput = {
  full_name?: string; employee_id?: string | null; department_id?: string | null; role?: Role;
};

export async function updateUser(id: string, input: UserUpdateInput, actor: string): Promise<UserRow> {
  const before = await load(id);
  assertActive((await loadLookups()).departments, input.department_id, 'department_id', before.department_id);

  // Đổi nhóm quyền ghi một dòng lịch sử (ROLE_CHANGE), sửa thông tin một dòng (UPDATE). Nhóm quyền trước: database
  // có thể chặn (ADMIN_SELF_CHANGE, LAST_ADMIN) và lúc đó chưa có gì được ghi.
  const { role, ...profile } = input;
  if (role !== undefined && role !== before.role) await appWrite('user_profiles', 'update', id, { role }, actor);
  const profileKeys = ['full_name', 'employee_id', 'department_id'] as const;
  if (profileKeys.some((k) => profile[k] !== undefined && profile[k] !== before[k])) {
    await appWrite('user_profiles', 'update', id, profile, actor);
  }
  return getUser(id);
}

/**
 * Khóa: is_active = false (database chặn Admin tự khóa mình / Admin cuối cùng) rồi ban ở Supabase Auth
 * (chặn đăng nhập mới và làm mới phiên). Server cũng kiểm tra is_active ở mọi request nên khóa có hiệu lực ngay.
 */
export async function setUserActive(id: string, active: boolean, actor: string): Promise<UserRow> {
  const before = await load(id);
  if (before.is_active === active) throw new AppError('VALIDATION_ERROR', { fields: { is_active: 'unchanged' } });

  if (!active) {
    await appWrite('user_profiles', 'update', id, { is_active: false }, actor);
    const { error } = await db().auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
    if (error) {
      // Không ban được: trả lại như cũ để Admin thấy lỗi và thử lại (thay vì để lại trạng thái nửa vời).
      try { await appWrite('user_profiles', 'update', id, { is_active: true }, actor); } catch { /* giữ lỗi gốc */ }
      throw new AppError('SERVER_ERROR', {}, { stage: 'ban_user', auth: error.message });
    }
  } else {
    // Bỏ ban trước: nếu bước sau lỗi thì tài khoản vẫn bị khóa bởi is_active = false (an toàn).
    const { error } = await db().auth.admin.updateUserById(id, { ban_duration: 'none' });
    if (error) throw new AppError('SERVER_ERROR', {}, { stage: 'unban_user', auth: error.message });
    await appWrite('user_profiles', 'update', id, { is_active: true }, actor);
  }
  return getUser(id);
}

/**
 * Admin đặt lại mật khẩu người khác: mật khẩu tạm mới, must_change_password = true (từ đó mọi API của họ bị
 * chặn cho tới khi đổi), lịch sử PASSWORD_RESET — ghi cả khi cờ vốn đã true. Dùng được cả cho tài khoản đang khóa.
 */
export async function resetUserPassword(id: string, actor: string): Promise<UserWithTempPassword> {
  if (id === actor) throw new AppError('ADMIN_SELF_CHANGE');
  await load(id);
  const password = generateTempPassword();
  const { error } = await db().auth.admin.updateUserById(id, { password });
  if (error) throw new AppError('SERVER_ERROR', {}, { stage: 'set_password', auth: error.message });
  await appWrite('user_profiles', 'update', id, { must_change_password: true }, actor, { action: 'PASSWORD_RESET' });
  return { user: await getUser(id), temp_password: password };
}

export function userHistory(id: string): Promise<HistoryEntry[]> {
  return readHistory('user_histories', [{ column: 'user_id', value: id }]);
}
