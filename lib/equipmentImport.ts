/**
 * Import Excel cho Equipment — phần dùng chung server (đọc / kiểm tra file,
 * sinh file mẫu) và giao diện (báo lỗi theo cột). docs/DETAIL_MODEL.md mục 2.
 * Golden dùng lại giới hạn, báo cáo và loại lỗi (lib/goldenImport.ts).
 */

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_FILE_MB = 5;

export type ImportColumnKey =
  | 'serial_number' | 'part_number_id' | 'jabil_id' | 'asset' | 'type_id'
  | 'level_id' | 'usage' | 'location_id' | 'parent_serial' | 'parent_part_number' | 'tag_ids' | 'remark';

/** Danh sách mà cột chọn từ đó: Configuration, hoặc `usages` (In use / Not in use — cố định của ứng dụng). */
export type ImportListKey = 'part_numbers' | 'types' | 'levels' | 'locations' | 'usages' | 'tags';

export type ImportColumn<K extends string = ImportColumnKey> = {
  key: K;
  /** Tiêu đề cột trong file. Đổi chữ này thì file đã tải trước đó không nhận ra cột. */
  header: string;
  required?: boolean;
  /** Bắt buộc, trừ khi dòng có thiết bị cha (Location: theo cha). */
  requiredUnlessParent?: boolean;
  /** Cột chữ: số ký tự tối đa (như form Thêm thiết bị). */
  max?: number;
  /** Cột chọn: danh sách Configuration + tên trang Configuration tương ứng. */
  list?: ImportListKey;
  page?: string;
  /** Danh sách cố định của ứng dụng (Status), không phải của Configuration. */
  fixed?: boolean;
  /** Một ô nhận nhiều giá trị, cách nhau dấu ; (Tags): không có ô thả xuống, giá trị hợp lệ ở sheet "Giá trị hợp lệ". */
  multi?: boolean;
  /** Bề rộng cột trong file mẫu. */
  width: number;
};

/**
 * Các cột của file, theo thứ tự form Thêm thiết bị (docs/DATABASE_MODIFIED.md mục 2).
 * Thiết bị cha: tìm theo serial (thiết bị đã có hoặc dòng khác trong file);
 * part number cha chỉ cần khi serial đó trùng ở nhiều thiết bị. Status và Tags không bắt buộc: file mẫu cũ không có hai
 * cột này vẫn import được (Status = Not in use, không có thẻ).
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'serial_number', header: 'Serial number', required: true, max: 200, width: 24 },
  { key: 'part_number_id', header: 'Part number', required: true, list: 'part_numbers', page: 'Part Number', width: 22 },
  { key: 'jabil_id', header: 'Jabil ID', max: 200, width: 16 },
  { key: 'asset', header: 'Asset', max: 200, width: 16 },
  { key: 'type_id', header: 'Type', list: 'types', page: 'Type', width: 18 },
  { key: 'level_id', header: 'Level', requiredUnlessParent: true, list: 'levels', page: 'Level', width: 16 },
  { key: 'usage', header: 'Status', list: 'usages', fixed: true, width: 14 },
  { key: 'location_id', header: 'Location', requiredUnlessParent: true, list: 'locations', page: 'Location', width: 20 },
  { key: 'parent_serial', header: 'Parent serial number', max: 200, width: 24 },
  { key: 'parent_part_number', header: 'Parent part number', list: 'part_numbers', page: 'Part Number', width: 22 },
  { key: 'tag_ids', header: 'Tags', list: 'tags', page: 'Tag', multi: true, width: 26 },
  { key: 'remark', header: 'Remark', max: 1000, width: 44 },
];

export type ImportIssueCode =
  | 'required' | 'too_long' | 'not_found' | 'inactive'
  | 'parent_not_found' | 'parent_ambiguous' | 'parent_cycle' | 'location_follows_parent' | 'level_follows_parent'
  | 'type_follows_part_number'
  /** Status không phải In use / Not in use. */
  | 'usage_invalid'
  /** Thiết bị con theo Status của cha: ô khác Status của cha. */
  | 'usage_follows_parent'
  /** In use cần cha — chỉ Tester được In use khi không có cha. */
  | 'usage_needs_parent'
  /** Part number thuộc loại khác (ví dụ part number của sub-equipment trong file Equipment). */
  | 'wrong_kind'
  /** Cha / tester không đúng loại theo cây tài sản (ví dụ Base dưới Base, Fixture dưới Golden). */
  | 'parent_type_invalid';

/**
 * Lỗi của một ô. `value`: chữ trong ô (location_follows_parent / level_follows_parent: vị trí / Level của thiết bị cha;
 * type_follows_part_number: Type của part number; usage_follows_parent: Status của cha; not_found của Tags: các thẻ chưa có, cách nhau dấu phẩy). `count`: parent_ambiguous.
 */
export type ImportIssue = { column: string; code: ImportIssueCode; value?: string; max?: number; count?: number };

export type ImportRowReport = {
  /** Số dòng trong Excel. */
  row: number;
  serial_number: string | null;
  issues: ImportIssue[];
  /** Serial trùng (chỉ cảnh báo): 'existing' = đã có trong hệ thống, số = dòng trước đó trong file. */
  duplicate_of: 'existing' | number | null;
};

export type ImportReport = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  committed: boolean;
  created: number;
  /** Cột có trong file nhưng không nhận ra (bỏ qua). */
  ignored_columns: string[];
  /** Chỉ các dòng có lỗi hoặc cảnh báo. */
  rows: ImportRowReport[];
};

/** Lỗi cả file: AppError VALIDATION_ERROR, details.fields.file = mã này (+ count / max / columns). */
export type ImportFileError = 'required' | 'too_large' | 'not_xlsx' | 'unreadable' | 'empty' | 'too_many_rows' | 'missing_columns';
