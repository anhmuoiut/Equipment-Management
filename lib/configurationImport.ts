/**
 * Import / Export Excel cho Configuration — các cột của file THEO ĐÚNG BẢNG trên màn hình (cùng thứ tự, cùng tiêu đề `fields.*` theo
 * ngôn ngữ, cùng chữ trong ô: In use / Hidden). File mẫu, file Export và bảng là MỘT: sửa file Export rồi import lại (Ghi đè).
 * Server đọc / kiểm tra / sinh file; giao diện báo lỗi theo cột. Giới hạn, báo cáo và loại lỗi dùng chung với Equipment
 * (lib/equipmentImport.ts). Tags (có màu) và Hiệu chuẩn › Setup (chu kỳ) không import — ít dòng, thêm tay.
 */
import type { ConfigListDef } from './configuration';
import type { ImportColumn } from './equipmentImport';

export type ConfigImportListKey = 'types' | 'levels' | 'type_groups' | 'states';

export type ConfigImportColumn = Omit<ImportColumn<string>, 'list'> & { list?: ConfigImportListKey };

export type Translate = (key: string) => string;

/** Cột của file → khóa nhãn của cột tương ứng ở bảng (fields.*). */
export const CONFIG_COLUMN_LABELS: Record<string, string> = {
  display_name: 'fields.display_name', type_id: 'fields.type', manufacturer: 'fields.manufacturer', level_id: 'fields.level',
  description: 'fields.description', remark: 'fields.remark', group_id: 'fields.group', sort_order: 'fields.sort_order', is_active: 'fields.is_active',
};

/** Danh sách có import (Tags và Hiệu chuẩn › Setup thì không). */
const IMPORT_LISTS = new Set(['part-numbers', 'locations', 'types', 'type-groups', 'levels', 'departments', 'calibration-vendors']);

/** Giá trị cho phép của cột Order (như app/api/configuration/schema.ts). */
export const CONFIG_ORDER_MAX = 100000;

/**
 * Các cột của file, theo thứ tự bảng Configuration (Name, Type, Manufacturer, Level, Group, Description, Remark, Order, In use); độ dài như
 * app/api/configuration/schema.ts. Order và In use không bắt buộc: dòng mới để trống = Order 0, In use; ghi đè để trống = giữ giá trị cũ.
 * `t`: dịch nhãn (tiêu đề cột = tiêu đề cột của bảng).
 */
export function configImportColumns(list: ConfigListDef, t: Translate): readonly ConfigImportColumn[] | null {
  if (!IMPORT_LISTS.has(list.key)) return null;
  const head = (key: string) => t(CONFIG_COLUMN_LABELS[key]!);
  const columns: ConfigImportColumn[] = [{ key: 'display_name', header: head('display_name'), required: true, max: 200, width: 28 }];
  if (list.hasType) columns.push({ key: 'type_id', header: head('type_id'), required: true, list: 'types', page: 'Type', width: 20 });
  if (list.hasManufacturer) columns.push({ key: 'manufacturer', header: head('manufacturer'), max: 200, width: 24 });
  if (list.hasLevel) columns.push({ key: 'level_id', header: head('level_id'), list: 'levels', page: 'Level', width: 16 });
  if (list.hasGroup) columns.push({ key: 'group_id', header: head('group_id'), required: true, list: 'type_groups', page: 'Group', width: 20 });
  if (list.hasDescription) columns.push({ key: 'description', header: head('description'), max: 1000, width: 44 });
  if (list.hasRemark) columns.push({ key: 'remark', header: head('remark'), max: 1000, width: 36 });
  columns.push({ key: 'sort_order', header: head('sort_order'), max: String(CONFIG_ORDER_MAX).length, width: 10 });
  columns.push({ key: 'is_active', header: head('is_active'), list: 'states', width: 14 });
  return columns;
}
