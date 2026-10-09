/**
 * Import Excel cho Calibration (sub-equipment) — các cột của file (server đọc / kiểm tra, sinh file mẫu; giao diện
 * báo lỗi theo cột). Giới hạn, báo cáo và loại lỗi dùng chung với Equipment (lib/equipmentImport.ts).
 */
import type { ImportColumn } from './equipmentImport';

export type SubImportColumnKey =
  | 'serial_number' | 'part_number_id' | 'jabil_id' | 'asset' | 'type_id' | 'location_id'
  | 'tester_serial' | 'tester_part_number' | 'remark';

/**
 * Các cột của file, theo thứ tự form Thêm sub-equipment (docs/DATABASE_MODIFIED.md mục 4). Tester: tìm theo serial trong
 * các tester đã có; part number của tester chỉ cần khi serial đó trùng ở nhiều thiết bị. Có tester thì vị trí theo tester.
 */
export const SUB_IMPORT_COLUMNS: readonly ImportColumn<SubImportColumnKey>[] = [
  { key: 'serial_number', header: 'Serial number', required: true, max: 200, width: 24 },
  { key: 'part_number_id', header: 'Part number', required: true, list: 'part_numbers', page: 'Part Number', width: 22 },
  { key: 'jabil_id', header: 'Jabil ID', max: 200, width: 16 },
  { key: 'asset', header: 'Asset', max: 200, width: 16 },
  { key: 'type_id', header: 'Type', list: 'types', page: 'Type', width: 18 },
  { key: 'location_id', header: 'Location', requiredUnlessParent: true, list: 'locations', page: 'Location', width: 20 },
  { key: 'tester_serial', header: 'Tester serial number', max: 200, width: 24 },
  { key: 'tester_part_number', header: 'Tester part number', list: 'part_numbers', page: 'Part Number', width: 22 },
  { key: 'remark', header: 'Remark', max: 1000, width: 44 },
];
