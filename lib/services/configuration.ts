import 'server-only';

/**
 * Module Configuration — 8 danh sách: dữ liệu gốc + hiệu chuẩn (Setup, Vendor),
 * bảng configuration_histories. Chỉ Admin.
 */
import { appWrite, db, selectAll, selectOne } from './core/db';
import { readHistory, withActorNames } from './core/history';
import { assertActive, auditOf, loadLookups, nameOf } from './core/lookups';
import { AppError, mapRpcError } from '@/lib/errors';
import type { ConfigListDef } from '@/lib/configuration';
import type { ConfigRow, ErrorLogRow, HistoryEntry, TypeKind } from '@/lib/types';

type DbRow = Record<string, unknown> & {
  id: string; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};

type Lookups = Awaited<ReturnType<typeof loadLookups>>;

export async function listConfig(list: ConfigListDef): Promise<ConfigRow[]> {
  const [rows, lookups] = await Promise.all([selectAll<DbRow>(list.table), loadLookups()]);
  return rows.map((r) => toRow(list, r, lookups));
}

function toRow(list: ConfigListDef, r: DbRow, lookups: Lookups): ConfigRow {
  const base = {
    id: r.id,
    display_name: list.isCalibration
      ? nameOf(lookups.part_numbers, r.part_number_id as string) ?? '—'
      : (r.display_name as string),
    sort_order: (r.sort_order as number | undefined) ?? 0,
    is_active: (r.is_active as boolean | undefined) ?? true,
    ...auditOf(lookups, r),
  };
  // Types: kind cho biết loại hệ thống (tester / base / fixture — khóa) hay loại sub-equipment do Admin thêm; group = nhóm (kind theo nhóm).
  if (list.hasGroup) {
    return {
      ...base, kind: r.kind as TypeKind,
      group_id: r.group_id as string, group: nameOf(lookups.type_groups, r.group_id as string),
    };
  }
  // Group của Type: kind cho biết nhóm hệ thống (khóa) hay nhóm Admin thêm (sub_equipment).
  if (list.isTypeGroup) return { ...base, kind: r.kind as TypeKind };
  if (list.hasType) {
    const levelId = (r.level_id as string | null | undefined) ?? null;
    return {
      ...base, type_id: r.type_id as string, type: nameOf(lookups.types, r.type_id as string),
      level_id: levelId, level: nameOf(lookups.levels, levelId),
      description: (r.description as string | null | undefined) ?? null,
    };
  }
  if (list.isTag) return { ...base, color: (r.color as ConfigRow['color']) ?? 'gray' };
  if (list.isCalibration) {
    return {
      ...base, part_number_id: r.part_number_id as string,
      interval_months: r.interval_months as number, warning_days: r.warning_days as number,
    };
  }
  return base;
}

export async function getConfig(list: ConfigListDef, id: string): Promise<ConfigRow> {
  const [row, lookups] = await Promise.all([selectOne<DbRow>(list.table, id), loadLookups()]);
  if (!row) throw new AppError('NOT_FOUND');
  return toRow(list, row, lookups);
}

export async function createConfig(list: ConfigListDef, input: Record<string, unknown>, actor: string): Promise<ConfigRow> {
  if (list.isCalibration) await assertPartNumberActive(input.part_number_id as string | undefined);
  if (list.hasType || list.hasGroup) {
    const lookups = await loadLookups();
    if (list.hasType) assertActive(lookups.types, input.type_id as string | undefined, 'type_id');
    if (list.hasLevel) assertActive(lookups.levels, input.level_id as string | null | undefined, 'level_id');
    if (list.hasGroup) assertTypeGroup(lookups, input.group_id as string | undefined);
  }
  const created = await appWrite<DbRow>(list.table, 'insert', null, input, actor);
  return getConfig(list, created.id);
}

/**
 * Part Number: Type chỉ đổi được khi chưa thiết bị nào dùng part number (database: PART_NUMBER_IN_USE); Level không bắt buộc,
 * chọn trong các Level đang dùng (giữ Level đã ẩn thì được). Types: 3 loại hệ thống (tester / base / fixture) không ẩn, không xóa,
 * không đổi kind (TYPE_SYSTEM_LOCKED); thêm mới luôn là sub_equipment — Group chọn trong các nhóm sub_equipment đang dùng, đổi nhóm
 * sang nhóm khác kind thì database chặn (TYPE_SYSTEM_LOCKED). Group (type-groups): 3 nhóm hệ thống không ẩn, không xóa.
 */
export async function updateConfig(list: ConfigListDef, id: string, input: Record<string, unknown>, actor: string): Promise<ConfigRow> {
  if ((list.hasType && input.type_id !== undefined) || (list.hasLevel && input.level_id !== undefined) || (list.hasGroup && input.group_id !== undefined)) {
    const [before, lookups] = await Promise.all([selectOne<DbRow>(list.table, id), loadLookups()]);
    if (!before) throw new AppError('NOT_FOUND');
    if (list.hasType && input.type_id !== undefined) assertActive(lookups.types, input.type_id as string, 'type_id', before.type_id as string);
    if (list.hasLevel && input.level_id !== undefined) {
      assertActive(lookups.levels, input.level_id as string | null, 'level_id', before.level_id as string | null);
    }
    if (list.hasGroup && input.group_id !== undefined) {
      assertActive(lookups.type_groups, input.group_id as string, 'group_id', before.group_id as string);
    }
  }
  if (Object.keys(input).length) await appWrite(list.table, 'update', id, input, actor);
  return getConfig(list, id);
}

/**
 * Xóa thật — chỉ tags và calibration_configurations. Thẻ đang được dùng thì database chặn (TAG_IN_USE).
 * Xóa Setup hiệu chuẩn: các lần hiệu chuẩn đã ghi giữ nguyên due_date; lần sau của part number đó phải nhập due_date.
 */
export async function deleteConfig(list: ConfigListDef, id: string, actor: string): Promise<void> {
  if (!list.deletable) throw new AppError('FORBIDDEN');
  await appWrite(list.table, 'delete', id, null, actor);
}

/** Type mới của Admin luôn là sub_equipment: nhóm phải có thật, đang dùng và là nhóm sub_equipment (không phải 3 nhóm hệ thống). */
function assertTypeGroup(lookups: Lookups, id: string | undefined) {
  if (!id) throw new AppError('VALIDATION_ERROR', { fields: { group_id: 'required' } });
  assertActive(lookups.type_groups, id, 'group_id');
  if (lookups.type_groups.get(id)?.kind !== 'sub_equipment') throw new AppError('VALIDATION_ERROR', { fields: { group_id: 'invalid' } });
}

async function assertPartNumberActive(id: string | undefined) {
  if (!id) throw new AppError('VALIDATION_ERROR', { fields: { part_number_id: 'required' } });
  const pn = await selectOne<{ is_active: boolean }>('part_numbers', id, 'is_active');
  if (!pn) throw new AppError('VALIDATION_ERROR', { fields: { part_number_id: 'not_found' } });
  if (!pn.is_active) throw new AppError('INACTIVE_OPTION', { fields: { part_number_id: 'inactive' } });
}

export function configHistory(list: ConfigListDef, id: string): Promise<HistoryEntry[]> {
  return readHistory('configuration_histories', [
    { column: 'table_name', value: list.table },
    { column: 'record_id', value: id },
  ]);
}

/** Configuration › HỆ THỐNG › Error log — chỉ xem, 1000 lỗi mới nhất. */
export async function listErrorLog(): Promise<ErrorLogRow[]> {
  const { data, error } = await db().from('error_log')
    .select('id, request_id, route, user_id, error_code, message, stack, created_at')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) throw mapRpcError(error);
  const rows = await withActorNames(((data ?? []) as Omit<ErrorLogRow, 'user_name'>[]).map((r) => ({ ...r, created_by: r.user_id })));
  return rows.map(({ created_by: _c, created_by_name, ...r }) => ({ ...r, user_name: created_by_name }));
}
