/**
 * Phân quyền theo nhóm — docs/DATABASE_MODIFIED.md "Phân quyền theo nhóm".
 *
 * Mỗi tài khoản thuộc đúng một nhóm (user_profiles.role). Quyền của từng nhóm
 * cố định trong code; không có quyền lẻ cho từng người.
 *   admin    — mọi thứ
 *   user     — xem, thêm, sửa, cập nhật; không xóa; không vào Configuration / User Management
 *   readonly — xem, tìm kiếm, xuất Excel
 *
 * Dùng chung cho server (withAuth, layout) và client (ẩn / hiện nút).
 */

export type Role = 'admin' | 'user' | 'readonly';
export const ROLES: readonly Role[] = ['admin', 'user', 'readonly'];

/** Nhóm được thêm / sửa / cập nhật dữ liệu nghiệp vụ. */
export const EDITORS: readonly Role[] = ['admin', 'user'];
/** Nhóm được xóa, vào Configuration và User Management. */
export const ADMINS: readonly Role[] = ['admin'];

export type UserProfile = {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  /** false = bị khóa: không vào được app dù còn phiên. */
  is_active: boolean;
  must_change_password: boolean;
};

export function canEdit(role: Role): boolean {
  return role === 'admin' || role === 'user';
}

export function canDelete(role: Role): boolean {
  return role === 'admin';
}

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}
