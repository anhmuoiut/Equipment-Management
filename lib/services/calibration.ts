import 'server-only';

/**
 * Module Calibration — bảng sub_equipment (thiết bị cần hiệu chuẩn, nằm trong tester) và calibrations (mỗi lần hiệu
 * chuẩn một dòng). docs/DATABASE.md.
 *
 * Phụ thuộc một chiều vào Equipment (tên tester). Calibration Status KHÔNG lưu và không tính ở đây: đọc từ view
 * sub_equipment_calibration (lần hiệu chuẩn mới nhất + Setup của part number). due_date của một lần hiệu chuẩn do
 * database tự tính (calibrated_at + interval_months của Setup). Nhật ký ghi vào asset_logs (CALIBRATE…).
 */
import { appWrite, db, selectOne } from './core/db';
import { applyTreeEdit, assetLog, previewTreeEdit } from './core/assets';
import { runList, type ListPage, type ListParams, type ListSpec } from './core/listQuery';
import { assertActive, assertTags, auditOf, loadLookups, nameOf, tagItems, type Lookups } from './core/lookups';
import { AppError, mapRpcError } from '@/lib/errors';
import { CALIBRATION_STATUSES, USAGE_STATUSES } from '@/lib/status';
import type { CalibrationRecord, CalibrationResult, CalibrationStatus, HistoryEntry, SubEquipmentRow, Usage } from '@/lib/types';

type DbSub = {
  id: string; jabil_id: string | null; part_number_id: string; serial_number: string; asset: string | null; type_id: string;
  tester_id: string | null; location_id: string; usage: Usage; remark: string | null; tag_ids: string[];
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};
/** Một dòng của view sub_equipment_calibration. */
type DbStatus = {
  sub_equipment_id: string; calibration_id: string | null; calibrated_at: string | null; due_date: string | null;
  vendor_id: string | null; cert_no: string | null; cert_file_url: string | null; result: CalibrationResult | null;
  interval_months: number | null; warning_days: number | null; status: CalibrationStatus;
};
type DbCalibration = {
  id: string; sub_equipment_id: string; calibrated_at: string; due_date: string; vendor_id: string | null;
  cert_no: string | null; cert_file_url: string | null; result: CalibrationResult; remark: string | null;
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};

/**
 * Trường nhập của form sub-equipment. Type không nhập (theo part number). `tester_id`: gắn vào tester (vị trí và Status
 * theo tester); null = chưa gắn. Đổi tester / vị trí khi sửa đi qua Move / Detach / Đổi vị trí của database.
 */
export type SubEquipmentInput = {
  serial_number?: string; jabil_id?: string | null; part_number_id?: string; asset?: string | null;
  tester_id?: string | null; location_id?: string | null; remark?: string | null; tag_ids?: string[];
};

export type CalibrationInput = {
  calibrated_at?: string; due_date?: string | null; vendor_id?: string | null; cert_no?: string | null;
  cert_file_url?: string | null; result?: CalibrationResult; remark?: string | null;
};

const NO_CALIBRATION: Omit<DbStatus, 'sub_equipment_id'> = {
  calibration_id: null, calibrated_at: null, due_date: null, vendor_id: null, cert_no: null, cert_file_url: null,
  result: null, interval_months: null, warning_days: null, status: 'not_calibrated',
};

/** Tester kèm serial — PostgREST gửi cùng một truy vấn, không cần đọc tester riêng. */
const WITH_TESTER = '*, tester:tester_id(serial_number)';
type WithTester = DbSub & { tester: { serial_number: string } | null };

function toRow(s: WithTester, c: DbStatus | undefined, lookups: Lookups): SubEquipmentRow {
  const cal = c ?? { sub_equipment_id: s.id, ...NO_CALIBRATION };
  return {
    id: s.id,
    jabil_id: s.jabil_id,
    part_number_id: s.part_number_id, part_number: nameOf(lookups.part_numbers, s.part_number_id),
    serial_number: s.serial_number,
    asset: s.asset,
    type_id: s.type_id, type: nameOf(lookups.types, s.type_id),
    manufacturer: lookups.part_numbers.get(s.part_number_id)?.manufacturer ?? null,
    description: lookups.part_numbers.get(s.part_number_id)?.description ?? null,
    tester_id: s.tester_id, tester_serial: s.tester?.serial_number ?? null,
    location_id: s.location_id, location: nameOf(lookups.locations, s.location_id),
    usage: s.usage,
    remark: s.remark,
    tag_ids: s.tag_ids ?? [], tags: tagItems(lookups, s.tag_ids),
    status: cal.status,
    calibration_id: cal.calibration_id, calibrated_at: cal.calibrated_at, due_date: cal.due_date, result: cal.result,
    vendor_id: cal.vendor_id, vendor: nameOf(lookups.calibration_vendors, cal.vendor_id),
    cert_no: cal.cert_no, cert_file_url: cal.cert_file_url,
    interval_months: cal.interval_months, warning_days: cal.warning_days,
    ...auditOf(lookups, s),
  };
}

/**
 * Masterlist Calibration: MỘT trang của view sub_equipment_list (migration 20261016000000) — mỗi sub-equipment một dòng kèm lần hiệu chuẩn mới nhất và
 * Calibration Status (view sub_equipment_calibration), phân trang / tìm / lọc / sắp xếp chạy ở database. Lọc nhanh: overdue, due_soon,
 * attention (chưa hiệu chuẩn hoặc không đạt).
 */
export const SUB_EQUIPMENT_LIST: ListSpec = {
  view: 'sub_equipment_list',
  select: 'id, jabil_id, part_number_id, serial_number, asset, type_id, tester_id, location_id, usage, remark, tag_ids, '
    + 'created_at, created_by, updated_at, updated_by, tester_serial, calibration_id, calibrated_at, due_date, vendor_id, cert_no, '
    + 'cert_file_url, result, interval_months, warning_days, status',
  sort: {
    status: 'status', usage: 'usage', serial_number: 'serial_nk', part_number: 'part_nk', type: 'type_nk', tester: 'tester_nk',
    location: 'location_nk', calibrated_at: 'calibrated_at', due_date: 'due_date', vendor: 'vendor_nk', cert_no: 'cert_nk', result: 'result',
    jabil_id: 'jabil_nk', asset: 'asset_nk', tags: 'tags_text', remark: 'remark',
    manufacturer: 'manufacturer_nk', description: 'description_nk',
  },
  defaultOrder: [['created_at', 'desc']],
  filters: {
    status: { column: 'status', kind: 'enum', values: CALIBRATION_STATUSES },
    usage: { column: 'usage', kind: 'enum', values: USAGE_STATUSES },
    part_number: { column: 'part_number_id', kind: 'id' },
    type: { column: 'type_id', kind: 'id' },
    tester: { column: 'tester_serial', kind: 'text', allowEmpty: true },
    location: { column: 'location_id', kind: 'id' },
    vendor: { column: 'vendor_id', kind: 'id', allowEmpty: true },
    result: { column: 'result', kind: 'enum', values: ['pass', 'fail'], allowEmpty: true },
    manufacturer: { column: 'manufacturer', kind: 'text', allowEmpty: true },
    tags: { column: 'tag_ids', kind: 'tag' },
  },
  quick: {
    overdue: { column: 'status', values: ['overdue'] },
    due_soon: { column: 'status', values: ['due_soon'] },
    attention: { column: 'status', values: ['not_calibrated', 'failed'] },
  },
  searchEnums: { usage: USAGE_STATUSES, status: CALIBRATION_STATUSES, result: ['pass', 'fail'] },
};

type ListRow = DbSub & Omit<DbStatus, 'sub_equipment_id'> & { tester_serial: string | null };

export async function listSubEquipment(params: ListParams): Promise<ListPage<SubEquipmentRow>> {
  const [page, lookups] = await Promise.all([runList<ListRow>(SUB_EQUIPMENT_LIST, params), loadLookups()]);
  return {
    ...page,
    rows: page.rows.map((r) => toRow({ ...r, tester: r.tester_serial ? { serial_number: r.tester_serial } : null }, { ...r, sub_equipment_id: r.id }, lookups)),
  };
}

export async function getSubEquipment(id: string): Promise<SubEquipmentRow> {
  const [row, status, lookups] = await Promise.all([
    selectOne<WithTester>('sub_equipment', id, WITH_TESTER),
    db().from('sub_equipment_calibration').select('*').eq('sub_equipment_id', id).maybeSingle(),
    loadLookups(),
  ]);
  if (!row) throw new AppError('NOT_FOUND');
  if (status.error) throw mapRpcError(status.error);
  return toRow(row, (status.data as DbStatus | null) ?? undefined, lookups);
}

function validate(input: SubEquipmentInput, lookups: Lookups, before?: DbSub) {
  assertActive(lookups.part_numbers, input.part_number_id, 'part_number_id', before?.part_number_id);
  assertActive(lookups.locations, input.location_id, 'location_id', before?.location_id);
  assertTags(lookups, input.tag_ids);
}

/** Thêm sub-equipment. Có tester thì vị trí và Status theo tester (database). Part number phải thuộc loại sub_equipment. */
export async function createSubEquipment(input: SubEquipmentInput, actor: string): Promise<SubEquipmentRow> {
  if (!input.serial_number) throw new AppError('VALIDATION_ERROR', { fields: { serial_number: 'required' } });
  if (!input.part_number_id) throw new AppError('VALIDATION_ERROR', { fields: { part_number_id: 'required' } });
  if (!input.tester_id && !input.location_id) throw new AppError('VALIDATION_ERROR', { fields: { location_id: 'required' } });
  const lookups = await loadLookups();
  const { location_id, ...rest } = input;
  validate({ ...rest, location_id: input.tester_id ? undefined : location_id }, lookups);
  // Có tester: database đặt vị trí theo tester (PARENT_NOT_FOUND / PARENT_TYPE_INVALID nếu tester không hợp lệ).
  const data = input.tester_id ? rest : input;
  const created = await appWrite<DbSub>('sub_equipment', 'insert', null, data, actor);
  return getSubEquipment(created.id);
}

/** Sửa thông tin; đổi tester → Move / Detach, đổi vị trí (chưa gắn tester) → Đổi vị trí. Chạy thử trước khi ghi. */
export async function updateSubEquipment(id: string, input: SubEquipmentInput, actor: string): Promise<SubEquipmentRow> {
  const [before, lookups] = await Promise.all([selectOne<DbSub>('sub_equipment', id), loadLookups()]);
  if (!before) throw new AppError('NOT_FOUND');

  const { location_id, tester_id: testerInput, ...fields } = input;
  const parentChanged = testerInput !== undefined && testerInput !== before.tester_id;
  const parentAfter = testerInput !== undefined ? testerInput : before.tester_id;
  const locationChanged = location_id !== undefined && location_id !== before.location_id;
  if (locationChanged && parentAfter && !parentChanged) throw new AppError('LOCATION_INHERITED_READ_ONLY');
  const setLocation = locationChanged && !parentAfter;

  validate({ ...fields, location_id: setLocation ? location_id : undefined }, lookups, before);
  const edit = { parentTo: parentChanged ? testerInput : undefined, location: setLocation ? location_id! : undefined };
  await previewTreeEdit('sub_equipment', id, edit, actor);
  if (Object.keys(fields).length) await appWrite('sub_equipment', 'update', id, fields, actor);
  await applyTreeEdit('sub_equipment', id, edit, actor);
  return getSubEquipment(id);
}

// ------------------------------------------------------- Lịch sử hiệu chuẩn
function toRecord(c: DbCalibration, lookups: Lookups): CalibrationRecord {
  return {
    id: c.id, sub_equipment_id: c.sub_equipment_id, calibrated_at: c.calibrated_at, due_date: c.due_date,
    vendor_id: c.vendor_id, vendor: nameOf(lookups.calibration_vendors, c.vendor_id),
    cert_no: c.cert_no, cert_file_url: c.cert_file_url, result: c.result, remark: c.remark,
    ...auditOf(lookups, c),
  };
}

/** Các lần hiệu chuẩn của một sub-equipment, mới nhất lên đầu. */
export async function listCalibrations(subEquipmentId: string): Promise<CalibrationRecord[]> {
  const [exists, { data, error }, lookups] = await Promise.all([
    selectOne<{ id: string }>('sub_equipment', subEquipmentId, 'id'),
    db().from('calibrations').select('*').eq('sub_equipment_id', subEquipmentId)
      .order('calibrated_at', { ascending: false }).order('created_at', { ascending: false }),
    loadLookups(),
  ]);
  if (!exists) throw new AppError('NOT_FOUND');
  if (error) throw mapRpcError(error);
  return ((data ?? []) as DbCalibration[]).map((c) => toRecord(c, lookups));
}

/**
 * Ghi nhận một lần hiệu chuẩn (thêm một dòng calibrations; các lần trước giữ nguyên làm lịch sử).
 * due_date: part number có Setup thì database tự tính (bỏ qua giá trị gửi lên); chưa có Setup thì bắt buộc nhập
 * (CALIBRATION_INTERVAL_MISSING). Trả về lần hiệu chuẩn mới và sub-equipment đã cập nhật Calibration Status.
 */
export async function addCalibration(subEquipmentId: string, input: CalibrationInput, actor: string) {
  if (!input.calibrated_at) throw new AppError('VALIDATION_ERROR', { fields: { calibrated_at: 'required' } });
  const [exists, lookups] = await Promise.all([selectOne<{ id: string }>('sub_equipment', subEquipmentId, 'id'), loadLookups()]);
  if (!exists) throw new AppError('NOT_FOUND');
  assertActive(lookups.calibration_vendors, input.vendor_id, 'vendor_id');
  const created = await appWrite<DbCalibration>('calibrations', 'insert', null, { ...input, sub_equipment_id: subEquipmentId }, actor);
  return { record: toRecord(created, lookups), sub_equipment: await getSubEquipment(subEquipmentId) };
}

/** Sửa một lần hiệu chuẩn nhập sai (CALIBRATION_UPDATE). Đổi calibrated_at thì due_date của lần đó tính lại theo Setup hiện tại. */
export async function updateCalibration(id: string, input: CalibrationInput, actor: string) {
  const [before, lookups] = await Promise.all([selectOne<DbCalibration>('calibrations', id), loadLookups()]);
  if (!before) throw new AppError('NOT_FOUND');
  assertActive(lookups.calibration_vendors, input.vendor_id, 'vendor_id', before.vendor_id);
  const updated = Object.keys(input).length ? await appWrite<DbCalibration>('calibrations', 'update', id, input, actor) : before;
  return { record: toRecord(updated, lookups), sub_equipment: await getSubEquipment(before.sub_equipment_id) };
}

/** Xóa một lần hiệu chuẩn (Admin; CALIBRATION_REMOVE). */
export async function deleteCalibration(id: string, actor: string) {
  const before = await selectOne<DbCalibration>('calibrations', id, 'id, sub_equipment_id');
  if (!before) throw new AppError('NOT_FOUND');
  await appWrite('calibrations', 'delete', id, null, actor);
  return { sub_equipment: await getSubEquipment(before.sub_equipment_id) };
}

const CALIBRATION_ACTIONS = ['CALIBRATE', 'CALIBRATION_UPDATE', 'CALIBRATION_REMOVE'] as const;

/** Tab Lịch sử của sub-equipment; `onlyCalibrations`: chỉ các lần hiệu chuẩn. */
export async function subEquipmentHistory(id: string, onlyCalibrations = false): Promise<HistoryEntry[]> {
  return assetLog('sub_equipment', id, onlyCalibrations ? CALIBRATION_ACTIONS : undefined);
}
