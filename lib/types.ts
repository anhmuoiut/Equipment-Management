/**
 * Kiểu dữ liệu trao đổi giữa server và client (theo
 * docs/DATABASE.md). Chỉ có type, dùng được ở cả hai phía.
 * FK luôn đi kèm chữ hiển thị (display_name) để UI không phải tra lại.
 */
import type { Role } from '@/lib/permissions';

/** Thông tin hệ thống — nhóm cuối của mọi Detail Panel. */
export type Audit = {
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
};

// ---------------------------------------------------------------- Lựa chọn
/** Loại (types.kind): tester / base / fixture là 3 loại hệ thống → bảng equipment; sub_equipment → bảng sub_equipment. */
export type TypeKind = 'tester' | 'base' | 'fixture' | 'sub_equipment';
/** Loại của một equipment. */
export type EquipmentKind = 'tester' | 'base' | 'fixture';
/** Ba bảng tài sản; dùng chung cho nhật ký (asset_logs) và các hàm thao tác cây. */
export type AssetType = 'equipment' | 'sub_equipment' | 'golden_board';

export type OptionItem = { id: string; display_name: string; sort_order: number; is_active: boolean };
/** `group_id`: nhóm của Type (Configuration › Group); `kind` luôn theo nhóm. */
export type TypeOption = OptionItem & { kind: TypeKind; group_id: string };
/** Nhóm của Type: Admin chọn trong các nhóm `kind = sub_equipment` (3 nhóm hệ thống khóa). */
export type TypeGroupOption = OptionItem & { kind: TypeKind };
/** Part number + Type mà mọi thiết bị mang part number này có (kind quyết định thiết bị thuộc bảng nào) + Level (không bắt buộc; điền sẵn khi thêm thiết bị). */
export type PartNumberOption = OptionItem & { type_id: string; kind: TypeKind; level_id: string | null };
/** Shared color keys; purple is an explicit manual tag palette. */
export type StatusColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'purple';
/** Thẻ (Configuration › Tag) để chọn trong phần Remark của Equipment / Calibration / Golden. */
export type TagOption = { id: string; display_name: string; sort_order: number; color: StatusColor };
/** Thẻ đang gắn trên một bản ghi (đã xếp theo thứ tự cấu hình). */
export type TagItem = { id: string; display_name: string; color: StatusColor };
export type Options = {
  part_numbers: PartNumberOption[];
  locations: OptionItem[];
  types: TypeOption[];
  type_groups: TypeGroupOption[];
  levels: OptionItem[];
  departments: OptionItem[];
  calibration_vendors: OptionItem[];
  tags: TagOption[];
};

// ----------------------------------------------------------- Cây tài sản
/** Đang dùng / không dùng — đổi bằng Check-out / Check-in và đổi theo chỗ khi Swap / Move / Detach (không phải Status của thẻ). */
export type Usage = 'in_use' | 'not_in_use';

/** Một thay đổi sẽ được ghi / đã ghi vào asset_logs (kết quả của hàm thao tác, dạng asset_logs). */
export type AssetChange = {
  asset_type: AssetType; asset_id: string; label: string; action: string;
  from_location: string | null; to_location: string | null; reason: string | null;
  old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null;
};
/** Tài sản đổi Status (Usage), ví dụ in_use → not_in_use khi Move vào cha Not in use hoặc Tách khỏi cha. */
export type UsageChange = { asset_type: AssetType; asset_id: string; label: string; from: Usage; to: Usage };
/**
 * Kết quả của mọi hàm thao tác (asset_*, import) — cùng một dạng cho dry run (`dry_run = true`: chỉ xem trước)
 * và thao tác thật. Hàm import chỉ có `count`.
 */
export type AssetOpResult = {
  dry_run: boolean; count: number; deleted: number; usage_changes: UsageChange[]; changes: AssetChange[];
};

/** Cha hợp lệ để gắn vào (valid_parents). `usage_after` = Status của tài sản SAU khi gắn vào cha đó. */
export type ParentCandidate = {
  id: string; kind: EquipmentKind; serial_number: string; part_number: string; type_name: string;
  location_id: string; location: string; usage: Usage; usage_after: Usage;
};
/** Tài sản có thể Swap với một tài sản (swap_candidates). `same_place`: cùng cha, cùng vị trí → Swap sẽ báo SWAP_NO_CHANGE. */
export type SwapCandidate = {
  asset_type: AssetType; id: string; kind: EquipmentKind | 'sub_equipment' | 'golden_board'; serial_number: string;
  part_number: string; type_name: string | null; parent_id: string | null; parent_serial: string | null;
  location_id: string; location: string; usage: Usage; same_place: boolean;
};
/** Tài sản có cùng serial ở cả ba bảng (serial_matches) — popup cảnh báo trước khi lưu. */
export type SerialMatch = {
  asset_type: AssetType; id: string; serial_number: string; part_number: string; location: string;
};

// --------------------------------------------------------------- Equipment
export type EquipmentRow = Audit & {
  id: string;
  jabil_id: string | null;
  part_number_id: string | null;
  part_number: string | null;
  serial_number: string;
  asset: string | null;
  type_id: string | null;
  type: string | null;
  /** tester / base / fixture (types.kind của type_id). */
  kind: EquipmentKind | null;
  /** Status của thiết bị: In use / Not in use (hệ thống tự quản; đổi bằng Check-out / Check-in). */
  usage: Usage;
  level_id: string | null;
  level: string | null;
  location_id: string;
  location: string | null;
  remark: string | null;
  tag_ids: string[];
  tags: TagItem[];
  parent_id: string | null;
  parent_serial: string | null;
  /** Có con trực tiếp ở bất kỳ bảng nào (equipment, sub-equipment, golden board). */
  has_children: boolean;
};

/** Loại của một tài sản trong cây: ba loại equipment (theo Type) và hai bảng còn lại. */
export type AssetKind = EquipmentKind | 'sub_equipment' | 'golden_board';

/** Một nút của cây trong tab "Cây thiết bị" (Tester gốc → mọi con cháu, cả sub-equipment và golden board). */
export type TreeNode = {
  asset_type: AssetType; id: string; kind: AssetKind; parent_id: string | null; part_number: string | null; serial_number: string;
  /** Tên Type (golden board không có). */
  type_name: string | null;
  usage: Usage;
  /** Sub-equipment: Calibration Status; còn lại null. */
  cal_status: CalibrationStatus | null;
};

/**
 * Phản hồi của `GET /api/equipment/{id}/tree`: cây từ tài sản gốc (đi ngược theo cha), dạng danh sách phẳng theo thứ tự cây
 * (cha trước con; anh em Base → Fixture → Golden → Sub rồi serial). Modal Equipment lấy cả con trực tiếp (chip, tóm tắt hiệu chuẩn) từ đây.
 */
export type EquipmentTree = { root_id: string; nodes: TreeNode[] };

// ------------------------------------------------- Sub-equipment, Calibration
/** Calibration Status (hệ thống tự tính từ lần hiệu chuẩn mới nhất — view sub_equipment_calibration). */
export type CalibrationStatus = 'not_calibrated' | 'failed' | 'overdue' | 'due_soon' | 'valid';
export type CalibrationResult = 'pass' | 'fail';

export type SubEquipmentRow = Audit & {
  id: string;
  jabil_id: string | null;
  part_number_id: string | null;
  part_number: string | null;
  serial_number: string;
  asset: string | null;
  type_id: string | null;
  type: string | null;
  tester_id: string | null;
  tester_serial: string | null;
  location_id: string;
  location: string | null;
  usage: Usage;
  remark: string | null;
  tag_ids: string[];
  tags: TagItem[];
  /** Lần hiệu chuẩn mới nhất và Calibration Status (view sub_equipment_calibration). */
  status: CalibrationStatus;
  calibration_id: string | null;
  calibrated_at: string | null;
  due_date: string | null;
  result: CalibrationResult | null;
  vendor_id: string | null;
  vendor: string | null;
  cert_no: string | null;
  cert_file_url: string | null;
  interval_months: number | null;
  warning_days: number | null;
};

/** Một lần hiệu chuẩn (bảng calibrations). */
export type CalibrationRecord = Audit & {
  id: string;
  sub_equipment_id: string;
  calibrated_at: string;
  due_date: string;
  vendor_id: string | null;
  vendor: string | null;
  cert_no: string | null;
  cert_file_url: string | null;
  result: CalibrationResult;
  remark: string | null;
};

// ------------------------------------------------------------ Golden board
export type GoldenRow = Audit & {
  id: string;
  part_number: string;
  serial_number: string;
  utd_part_number: string | null;
  origin: string | null;
  purpose: string | null;
  parent_id: string | null;
  parent_serial: string | null;
  location_id: string;
  location: string | null;
  usage: Usage;
  remark: string | null;
  tag_ids: string[];
  tags: TagItem[];
};

// ---------------------------------------------------------------- Overview
/** Cảnh báo hiệu chuẩn trên thẻ: failed / overdue = đỏ, due_soon = vàng. */
export type CalAlert = 'failed' | 'overdue' | 'due_soon';

/** Một thẻ của bảng Overview (một dòng của overview_board). */
export type OverviewCard = {
  asset_type: AssetType;
  id: string;
  kind: AssetKind;
  /** Tên Type; golden board không có. */
  type_name: string | null;
  part_number: string | null;
  serial_number: string;
  usage: Usage;
  /** Cảnh báo xấu nhất trong thẻ và mọi con cháu của nó; null = không có. */
  cal_alert: CalAlert | null;
  parent_id: string | null;
  /** 0 = thẻ gốc, tối đa 3. */
  depth: number;
  /** Thẻ khớp bộ lọc (chỉ khi đang lọc) — được tô nổi bật. */
  matched: boolean;
};

/** Một cột: thẻ gốc (cards[0]) và các thẻ con đã chọn, theo thứ tự vẽ. */
export type OverviewColumn = {
  root_id: string;
  cards: OverviewCard[];
  /** Số "+N thiết bị": con cháu của thẻ gốc không hiện trong cột. */
  more: number;
  /** Số sub-equipment có cảnh báo trong cả cột. */
  alerts: number;
};

/** Một Location: số liệu header + các cột (Tester trước, rồi tài sản chưa gắn). */
export type OverviewSection = {
  location_id: string;
  location: string;
  columns: OverviewColumn[];
  testers: number;
  in_use: number;
  alerts: number;
  /** Cảnh báo xấu nhất của các cột (tô màu ⚠ ở header); null = không có. */
  worst: CalAlert | null;
};

export type OverviewBoard = { sections: OverviewSection[] };

// ---------------------------------------------------------- Configuration
export type ConfigList =
  | 'part-numbers' | 'locations' | 'types' | 'type-groups' | 'tags' | 'levels' | 'departments'
  | 'calibration-setup' | 'calibration-vendors';

export type ConfigRow = Audit & {
  id: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
  description?: string | null;                 // part-numbers
  kind?: TypeKind;                            // types, type-groups (tester / base / fixture khóa; sub_equipment do Admin thêm)
  group_id?: string;                           // types
  group?: string | null;                       // types
  type_id?: string;                            // part-numbers
  type?: string | null;                        // part-numbers
  level_id?: string | null;                    // part-numbers (không bắt buộc)
  level?: string | null;                       // part-numbers
  color?: StatusColor;                         // tags
  part_number_id?: string;                     // calibration-setup
  interval_months?: number;                    // calibration-setup
  warning_days?: number;                       // calibration-setup
};

export type ErrorLogRow = {
  id: string; request_id: string; route: string | null; user_id: string | null; user_name: string | null;
  error_code: string | null; message: string | null; stack: string | null; created_at: string;
};

// --------------------------------------------------------- User Management
export type UserRow = Audit & {
  id: string;
  username: string;
  full_name: string;
  employee_id: string | null;
  department_id: string | null;
  department: string | null;
  role: Role;
  /** false = đã khóa. */
  is_active: boolean;
  must_change_password: boolean;
};

/** Kết quả Thêm tài khoản / Đặt lại mật khẩu: mật khẩu tạm chỉ hiện một lần. */
export type UserWithTempPassword = { user: UserRow; temp_password: string };

// ----------------------------------------------------------------- Lịch sử
export type HistoryChange = { old: unknown; new: unknown };
export type HistoryEntry = {
  id: string;
  label: string;
  action: string;
  changes: Record<string, HistoryChange>;
  note: string | null;
  source: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  /** Chỉ nhật ký tài sản: vị trí trước / sau khi vị trí đổi. */
  from_location?: string | null;
  to_location?: string | null;
};

export type HistoryModule = AssetType | 'configuration' | 'user';
/** Một bản ghi bị ảnh hưởng bởi một thao tác (nhật ký của chính bản ghi đó). */
export type ActionRecord = {
  module: HistoryModule; object_id: string; label: string; action: string;
  changes: Record<string, HistoryChange>; note: string | null;
  from_location?: string | null; to_location?: string | null;
};
/**
 * "Thay đổi gần đây": MỘT thao tác của người dùng = MỘT dòng (view recent_actions, gộp theo action_id). `records` = các bản ghi bị ảnh
 * hưởng, tối đa 50, bản ghi chính trước; `item_count` = tổng số dòng nhật ký của thao tác (một lần Import Excel = một dòng, item_count = số dòng).
 */
export type RecentAction = {
  id: string; module: HistoryModule; modules: HistoryModule[]; action: string; source: string;
  created_by: string | null; created_by_name: string | null; created_at: string;
  item_count: number; records: ActionRecord[];
};

// --------------------------------------------------------------- Dashboard
export type CountItem = { id: string | null; label: string | null; count: number };
/** `id`: khóa Status (in_use / not_in_use; not_calibrated / failed / overdue / due_soon / valid) — màn hình dịch ra chữ. */
export type StatusCountItem = CountItem & { color: StatusColor };
/** Một sub-equipment cần chú ý trên Dashboard (quá hạn / sắp đến hạn / không đạt / chưa hiệu chuẩn). */
export type CalibrationAlert = {
  id: string; serial_number: string; part_number: string | null; type: string | null; tester_serial: string | null;
  location: string | null; due_date: string | null; status: CalibrationStatus;
};
export type DashboardData = {
  equipment_total: number;
  sub_equipment_total: number;
  golden_total: number;
  /** Số lượng theo Status: Equipment, Sub-equipment, Golden board (In use / Not in use) và Calibration Status. */
  by_usage: Record<AssetType, StatusCountItem[]>;
  by_calibration_status: StatusCountItem[];
  by_tag: CountItem[];
  by_location: CountItem[];
  by_type: CountItem[];
  overdue: CalibrationAlert[];
  due_soon: CalibrationAlert[];
  /** Trang đầu của "Thay đổi gần đây" (không lọc, 50 thao tác) — chỉ `/api/dashboard` trả kèm. */
  activities?: RecentAction[];
};
