/**
 * seed-first-admin — tạo tài khoản Admin đầu tiên (chưa có admin thì không ai tạo được tài khoản khác).
 *
 * Chạy (từ thư mục Equipment-Management-System):
 *   npm run seed:admin -- <username> "<Họ tên>" [mã nhân viên]
 *
 * - Tự đọc .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) và tự tin chứng chỉ của Windows
 *   (mạng công ty có proxy SSL).
 * - Tài khoản là người dùng Supabase Auth với email nội bộ <username>@jabil.local, email_confirm: true
 *   (không gửi email, người dùng không thấy email này). Server phải dùng cùng cách đổi username → email.
 * - Hồ sơ ghi qua app_write (database/migrations, baseline) với source 'script' → lịch sử tài khoản ghi CREATE.
 * - Mật khẩu tạm dạng Jabil-4827 in ra MỘT lần; đăng nhập lần đầu bắt buộc đổi (must_change_password).
 * - Cần baseline migration và seed.sql đã chạy (docs/DEPLOY.md §3), và Supabase Dashboard đã tắt public sign-up (docs/DEPLOY.md).
 */
import { existsSync } from 'node:fs';
import tls from 'node:tls';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { INTERNAL_EMAIL_DOMAIN, normalizeUsername, usernameToEmail } from '../lib/auth/username';
import { generateTempPassword } from '../lib/auth/tempPassword';

function trustSystemCertificates() {
  const t = tls as typeof tls & {
    getCACertificates?: (type: 'default' | 'system') => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return;
  try {
    t.setDefaultCACertificates([...new Set([...t.getCACertificates('default'), ...t.getCACertificates('system')])]);
  } catch {
    // Node cũ: giữ mặc định; nếu bị proxy chặn SSL, chạy bằng `node --use-system-ca`.
  }
}

async function findAuthUserByEmail(db: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Không đọc được danh sách Supabase Auth: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  trustSystemCertificates();

  const [, , rawUsername, fullName, employeeId] = process.argv;
  const username = normalizeUsername(rawUsername);
  if (!username || !fullName) {
    console.error('Cách dùng: npm run seed:admin -- <username> "<Họ tên>" [mã nhân viên]');
    console.error('Username: chữ thường không dấu, số và . _ + - (tối đa 64 ký tự), ví dụ man.tran');
    process.exit(1);
  }
  const email = usernameToEmail(username);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (đặt trong .env.local).');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: existing, error: lookupError } = await db.from('user_profiles').select('id').eq('username', username).limit(1);
  if (lookupError) throw new Error(`Không đọc được user_profiles — đã chạy baseline migration và seed.sql chưa? (${lookupError.message})`);
  if (existing?.length) throw new Error(`Username "${username}" đã tồn tại.`);

  // Mật khẩu tạm dễ đọc, ví dụ Jabil-4827. Chỉ để vào lần đầu: đăng nhập xong bắt buộc đổi.
  const password = generateTempPassword();

  // Email đã có trong Supabase Auth mà chưa có hồ sơ (lần chạy trước dở dang): dùng lại, đặt mật khẩu mới SAU KHI
  // tạo hồ sơ thành công — lỗi giữa chừng không đổi gì.
  let authUserId: string;
  let createdAuthUser = false;
  const old = await findAuthUserByEmail(db, email);
  if (old) {
    const { data: profile } = await db.from('user_profiles').select('id').eq('id', old.id).maybeSingle();
    if (profile) throw new Error(`Email nội bộ ${email} đã gắn với một hồ sơ khác trong user_profiles.`);
    authUserId = old.id;
  } else {
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (!created.data.user) {
      throw new Error(`Tạo tài khoản Supabase Auth thất bại: ${created.error?.message ?? 'unknown'}. `
        + `Nếu báo email không hợp lệ thì Supabase không chấp nhận domain "${INTERNAL_EMAIL_DOMAIN}" — đổi INTERNAL_EMAIL_DOMAIN trong lib/auth/username.ts (dùng chung với server).`);
    }
    authUserId = created.data.user.id;
    createdAuthUser = true;
  }

  // Ghi qua app_write với source 'script' → lịch sử tài khoản ghi CREATE.
  const { error: profErr } = await db.rpc('app_write', {
    p_table: 'user_profiles',
    p_op: 'insert',
    p_id: null,
    p_data: {
      id: authUserId,
      username,
      full_name: fullName,
      employee_id: employeeId ?? null,
      role: 'admin',
      is_active: true,
      must_change_password: true,
    },
    p_actor: null,
    p_note: 'seed-first-admin',
    p_source: 'script',
  });
  if (profErr) {
    if (createdAuthUser) await db.auth.admin.deleteUser(authUserId);
    const hint = profErr.code === 'PGRST202' ? ' — chưa chạy baseline migration?' : '';
    throw new Error(`Tạo user_profiles thất bại: ${profErr.message}${hint}`);
  }
  if (!createdAuthUser) {
    const { error } = await db.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
    if (error) throw new Error(`Đã tạo hồ sơ admin nhưng không đặt được mật khẩu: ${error.message}`);
    console.log(`  (Dùng lại tài khoản Supabase Auth đã có của ${email}, đặt mật khẩu mới.)`);
  }

  console.log('\n  Admin đầu tiên đã được tạo.\n');
  console.log(`  Username     : ${username}`);
  console.log(`  Mật khẩu tạm : ${password}`);
  console.log('\n  Đăng nhập bằng USERNAME ở trên; app sẽ bắt đổi mật khẩu ngay lần đầu. Mật khẩu này không hiển thị lại.');
  console.log('  Nhớ tắt public sign-up và email confirmation trong Supabase Dashboard (docs/DEPLOY.md).\n');
}

main().catch((e: unknown) => {
  console.error(`\n  Tạo admin thất bại: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
