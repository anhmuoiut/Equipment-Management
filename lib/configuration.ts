/**
 * Các danh sách của menu Configuration — dùng chung server (bảng, quy tắc)
 * và client (danh sách con, cột, trường). docs/APP_SHELL.md mục 3.
 */
import type { ConfigList, StatusColor } from '@/lib/types';

export type ConfigGroup = 'master' | 'calibration' | 'system';

export type ConfigListDef = {
  key: ConfigList;
  table: string;
  group: ConfigGroup;
  /** Xóa = ẩn (is_active = false). */
  hideable: boolean;
  /** Xóa thật (tags khi không còn dùng, calibration_configurations). */
  deletable: boolean;
  hasDescription?: boolean;
  /** Part Number: Type bắt buộc — mọi thiết bị mang part number này có Type đó (đổi được khi chưa thiết bị nào dùng). */
  hasType?: boolean;
  /** Part Number: Level (không bắt buộc) chọn trong Configuration › Level; form Thêm thiết bị điền sẵn. */
  hasLevel?: boolean;
  /** Types: Group bắt buộc, chọn trong Configuration › Group (kind của Type luôn theo nhóm). */
  hasGroup?: boolean;
  /** Group của Type (type_groups): 3 nhóm hệ thống (tester / base / fixture) không ẩn, không xóa. */
  isTypeGroup?: boolean;
  /** Thẻ (có màu) chọn trong phần Remark của Equipment / Calibration / Golden sample. */
  isTag?: boolean;
  /** Hiệu chuẩn › Setup: part number loại sub_equipment, chu kỳ (tháng), báo trước (ngày). */
  isCalibration?: boolean;
};

export const CONFIG_LISTS: readonly ConfigListDef[] = [
  { key: 'part-numbers', table: 'part_numbers', group: 'master', hideable: true, deletable: false, hasType: true, hasLevel: true },
  { key: 'locations', table: 'locations', group: 'master', hideable: true, deletable: false },
  { key: 'types', table: 'types', group: 'master', hideable: true, deletable: false, hasDescription: true, hasGroup: true },
  { key: 'type-groups', table: 'type_groups', group: 'master', hideable: true, deletable: false, isTypeGroup: true },
  { key: 'tags', table: 'tags', group: 'master', hideable: false, deletable: true, isTag: true },
  { key: 'levels', table: 'levels', group: 'master', hideable: true, deletable: false },
  { key: 'departments', table: 'departments', group: 'master', hideable: true, deletable: false },
  { key: 'calibration-setup', table: 'calibration_configurations', group: 'calibration', hideable: false, deletable: true, isCalibration: true },
  { key: 'calibration-vendors', table: 'calibration_vendors', group: 'calibration', hideable: true, deletable: false },
];

export const CONFIG_GROUPS: readonly ConfigGroup[] = ['master', 'calibration', 'system'];

/**
 * 5 màu hệ thống admin chọn cho thẻ (docs/DATABASE_MODIFIED.md › tags).
 * Thứ tự hiển thị ở ô chọn màu: đèn giao thông trước, rồi xanh dương, xám.
 */
export const STATUS_COLORS = ['green', 'yellow', 'red', 'blue', 'gray'] as const satisfies readonly StatusColor[];

/** Trang chỉ xem trong nhóm HỆ THỐNG. */
export const ERROR_LOG_PATH = '/configuration/error-log';

export function configList(key: string): ConfigListDef | null {
  return CONFIG_LISTS.find((l) => l.key === key) ?? null;
}

export function configPath(key: ConfigList): string {
  return `/configuration/${key}`;
}
