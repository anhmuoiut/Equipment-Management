import { randomInt } from 'node:crypto';

/**
 * Mật khẩu tạm do hệ thống sinh, dễ đọc cho Admin chuyển miệng: `Jabil-4827`.
 * Chỉ để vào lần đầu — đăng nhập xong bắt buộc đổi (user_profiles.must_change_password).
 * Dùng chung cho User Management (Thêm, Đặt lại mật khẩu) và scripts/seed-first-admin.ts.
 */
export function generateTempPassword(): string {
  return `Jabil-${randomInt(1000, 10000)}`;
}
