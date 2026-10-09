/**
 * Màu và thứ tự cố định của các Status do hệ thống quản (không cấu hình): Status của tài sản (In use / Not in use)
 * và Calibration Status (tự tính từ lần hiệu chuẩn mới nhất). Dùng ở Dashboard (server) và các tag (client).
 */
import type { CalibrationStatus, StatusColor, Usage } from '@/lib/types';

export const USAGE_STATUSES: readonly Usage[] = ['in_use', 'not_in_use'];
export const USAGE_STATUS_COLOR: Record<Usage, StatusColor> = { in_use: 'green', not_in_use: 'gray' };

/** Thứ tự từ cần xử lý nhất tới ổn nhất. */
export const CALIBRATION_STATUSES: readonly CalibrationStatus[] = ['not_calibrated', 'failed', 'overdue', 'due_soon', 'valid'];
export const CALIBRATION_STATUS_COLOR: Record<CalibrationStatus, StatusColor> = {
  not_calibrated: 'gray', failed: 'red', overdue: 'red', due_soon: 'yellow', valid: 'green',
};
