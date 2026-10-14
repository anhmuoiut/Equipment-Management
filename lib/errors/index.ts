/**
 * Error layer.
 *
 * Quy ước: database `raise exception '<ERROR_CODE>'`, service bắt và đổi sang
 * AppError, withAuth biến thành response chuẩn. Không để lộ message gốc của
 * Postgres ra client. Chữ hiển thị cho người dùng nằm ở src/i18n/locales
 * (mục "errors") — message ở đây chỉ để ghi log.
 */

export const ERROR_CODES = {
  // Đăng nhập / phiên / quyền
  INVALID_CREDENTIALS:            { status: 401, message: 'Username or password is incorrect.' },
  CURRENT_PASSWORD_INCORRECT:     { status: 401, message: 'Current password is incorrect.' },
  LOGIN_RATE_LIMITED:             { status: 429, message: 'Too many attempts.' },
  USER_INACTIVE:                  { status: 403, message: 'Account is locked.' },
  UNAUTHORIZED:                   { status: 401, message: 'Not signed in.' },
  FORBIDDEN:                      { status: 403, message: 'Not allowed.' },
  PASSWORD_CHANGE_REQUIRED:       { status: 403, message: 'Password change required.' },
  // Chung
  VALIDATION_ERROR:               { status: 400, message: 'Invalid data.' },
  NOT_FOUND:                      { status: 404, message: 'Record not found.' },
  DUPLICATE_VALUE:                { status: 409, message: 'Value already exists.' },
  IN_USE:                         { status: 409, message: 'Record is in use.' },
  INACTIVE_OPTION:                { status: 400, message: 'Selected value is hidden.' },
  LOCK_TIMEOUT:                   { status: 409, message: 'Busy, try again.' },
  SERVER_ERROR:                   { status: 500, message: 'Server error.' },
  // User Management
  USERNAME_ALREADY_EXISTS:        { status: 409, message: 'Username already exists.' },
  ADMIN_SELF_CHANGE:              { status: 409, message: 'Admins cannot lock, demote or reset their own account here.' },
  LAST_ADMIN:                     { status: 409, message: 'At least one active admin is required.' },
  // Cây tài sản
  PARENT_TYPE_INVALID:            { status: 409, message: 'This parent is not allowed for this asset.' },
  PARENT_NOT_FOUND:               { status: 404, message: 'Parent not found.' },
  PARENT_NOT_IN_USE:              { status: 409, message: 'The parent is not In use, so this child cannot be checked out on its own.' },
  EQUIPMENT_HAS_NO_PARENT:        { status: 409, message: 'Asset has no parent.' },
  LOCATION_INHERITED_READ_ONLY:   { status: 409, message: 'Location follows the parent.' },
  SWAP_NO_CHANGE:                 { status: 409, message: 'Swap would change nothing.' },
  SWAP_TYPE_MISMATCH:             { status: 409, message: 'Only assets of the same kind and Type can be swapped.' },
  EQUIPMENT_IN_USE:               { status: 409, message: 'Asset is in use — check it in first.' },
  USAGE_NO_CHANGE:                { status: 409, message: 'Nothing to check out / check in.' },
  USAGE_NEEDS_PARENT:             { status: 409, message: 'Only a Tester can be In use without a parent.' },
  // Configuration / Calibration
  TYPE_KIND_INVALID:              { status: 409, message: 'This part number / Type is not valid here.' },
  TYPE_SYSTEM_LOCKED:             { status: 409, message: 'System Types cannot be changed.' },
  PART_NUMBER_IN_USE:             { status: 409, message: 'Part number is used by equipment, so its Type cannot change.' },
  TAG_IN_USE:                     { status: 409, message: 'Tag is in use.' },
  CALIBRATION_INTERVAL_MISSING:   { status: 400, message: 'Part number has no calibration interval.' },
  HISTORY_IS_APPEND_ONLY:         { status: 409, message: 'History cannot be edited or deleted.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Gửi cho client (lỗi 4xx) — chỉ thông tin an toàn, ví dụ lỗi theo trường. */
  readonly details: Record<string, unknown>;
  /** Chỉ cho developer (terminal / error_log) — message gốc của Postgres, gợi ý sửa. */
  readonly diagnostic: Record<string, unknown>;

  constructor(code: ErrorCode, details: Record<string, unknown> = {}, diagnostic: Record<string, unknown> = {}) {
    super(ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.diagnostic = diagnostic;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }
}

/** Mã lỗi Postgres → ErrorCode. */
const PG_STATE: Record<string, ErrorCode> = {
  '55P03': 'LOCK_TIMEOUT',      // lock_not_available
  '40P01': 'LOCK_TIMEOUT',      // deadlock_detected
  '57014': 'LOCK_TIMEOUT',      // query_canceled
  '23505': 'DUPLICATE_VALUE',   // unique_violation
  '23503': 'IN_USE',            // foreign_key_violation (xóa dòng đang được dùng)
  '23514': 'VALIDATION_ERROR',  // check_violation
  '23502': 'VALIDATION_ERROR',  // not_null_violation
  '22P02': 'VALIDATION_ERROR',  // invalid_text_representation (uuid sai…)
  '22007': 'VALIDATION_ERROR',  // invalid_datetime_format
};

type PgLikeError = { message?: string; code?: string; details?: string | null };

/**
 * `raise exception '<ERROR_CODE>'` → chính mã đó; còn lại theo SQLSTATE; không nhận ra → SERVER_ERROR.
 * Message / detail gốc của Postgres (tên bảng, câu lệnh…) chỉ vào `diagnostic`, không tới client.
 */
export function mapRpcError(error: PgLikeError | null): AppError {
  if (!error) return new AppError('SERVER_ERROR');
  const raw = (error.message ?? '').trim();
  const diagnostic = { pg: raw.slice(0, 200), pg_code: error.code, ...(error.details ? { pg_detail: error.details } : {}) };
  if (raw in ERROR_CODES) return new AppError(raw as ErrorCode, {}, diagnostic);
  if (error.code && PG_STATE[error.code]) return new AppError(PG_STATE[error.code]!, {}, diagnostic);
  // PostgREST không tìm thấy hàm / bảng: database chưa chạy đủ file trong database/.
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42883' || error.code === '42P01') {
    return new AppError('SERVER_ERROR', {}, {
      ...diagnostic,
      hint: 'Database is missing functions or tables — run database/migrations/*_baseline.sql (see docs/DEPLOY.md).',
    });
  }
  return new AppError('SERVER_ERROR', {}, diagnostic);
}
