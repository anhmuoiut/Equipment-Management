import 'server-only';

/**
 * Module Equipment — bảng equipment (tester / base / fixture). Nhật ký do database tự ghi vào asset_logs.
 * Không đọc bảng của module khác ngoài cây tài sản dùng chung (core/assets.ts: cờ "có con", cây thiết bị).
 * Thao tác trên cây (Đổi vị trí, Move, Swap, Detach, Check-out / Check-in, Xóa) dùng chung cho cả ba loại tài sản:
 * lib/services/core/assets.ts và route /api/assets.
 */
import { appWrite, rpc, selectAll, selectOne } from './core/db';
import {
  assetLog, assetOps, changeAssetLocation, equipmentWithLeafChildren,
} from './core/assets';
import { assertActive, assertTags, auditOf, kindOf, loadLookups, nameOf, tagItems, type Lookups } from './core/lookups';
import { AppError } from '@/lib/errors';
import type { AssetKind, AssetType, CalibrationStatus, EquipmentRow, EquipmentTree, HistoryEntry, TreeNode, Usage } from '@/lib/types';

type DbEquipment = {
  id: string; jabil_id: string | null; part_number_id: string; serial_number: string; asset: string | null;
  type_id: string; usage: Usage; level_id: string | null; location_id: string; remark: string | null; tag_ids: string[];
  parent_id: string | null; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};

/**
 * Trường nhập của form thiết bị. Type không nhập: luôn theo part number (database tự đặt).
 * `parent_id` (null = không có cha): có cha thì vị trí và Level theo cha. Đổi cha / vị trí khi sửa đi qua
 * các hàm thao tác của database (Move / Detach / Đổi vị trí) — con cháu luôn đi theo.
 */
export type EquipmentInput = {
  serial_number?: string; jabil_id?: string | null; part_number_id?: string; asset?: string | null;
  level_id?: string | null; location_id?: string | null; remark?: string | null; tag_ids?: string[];
  parent_id?: string | null;
};

function toRow(e: DbEquipment, lookups: Lookups, parentSerial: string | null, hasChildren: boolean): EquipmentRow {
  const kind = kindOf(lookups, e.type_id);
  return {
    id: e.id,
    jabil_id: e.jabil_id,
    part_number_id: e.part_number_id, part_number: nameOf(lookups.part_numbers, e.part_number_id),
    serial_number: e.serial_number,
    asset: e.asset,
    type_id: e.type_id, type: nameOf(lookups.types, e.type_id),
    kind: kind === 'tester' || kind === 'base' || kind === 'fixture' ? kind : null,
    usage: e.usage,
    level_id: e.level_id, level: nameOf(lookups.levels, e.level_id),
    location_id: e.location_id, location: nameOf(lookups.locations, e.location_id),
    remark: e.remark,
    tag_ids: e.tag_ids ?? [], tags: tagItems(lookups, e.tag_ids),
    parent_id: e.parent_id, parent_serial: parentSerial,
    has_children: hasChildren,
    ...auditOf(lookups, e),
  };
}

export async function listEquipment(): Promise<EquipmentRow[]> {
  const [rows, lookups, withLeaves] = await Promise.all([selectAll<DbEquipment>('equipment'), loadLookups(), equipmentWithLeafChildren()]);
  const serials = new Map(rows.map((r) => [r.id, r.serial_number]));
  const parents = new Set(rows.flatMap((r) => (r.parent_id ? [r.parent_id] : [])));
  return rows.map((r) => toRow(r, lookups, r.parent_id ? serials.get(r.parent_id) ?? null : null, parents.has(r.id) || withLeaves.has(r.id)));
}

/**
 * Một bản ghi: dòng + serial của cha + số con trực tiếp ở cả ba bảng (equipment, sub-equipment, golden board) trong MỘT truy vấn —
 * PostgREST nhúng `parent:parent_id(serial_number)` và `quan_hệ(count)`, không cần đọc cha / đếm con riêng.
 */
const WITH_RELATIONS = '*, parent:parent_id(serial_number), kids:equipment!parent_id(count), subs:sub_equipment!tester_id(count), golds:golden_boards!parent_id(count)';
type Count = { count: number }[] | null;
type WithRelations = DbEquipment & { parent: { serial_number: string } | null; kids: Count; subs: Count; golds: Count };

export async function getEquipment(id: string): Promise<EquipmentRow> {
  const [row, lookups] = await Promise.all([selectOne<WithRelations>('equipment', id, WITH_RELATIONS), loadLookups()]);
  if (!row) throw new AppError('NOT_FOUND');
  const children = [row.kids, row.subs, row.golds].reduce((sum, c) => sum + (c?.[0]?.count ?? 0), 0);
  return toRow(row, lookups, row.parent?.serial_number ?? null, children > 0);
}

function validate(input: EquipmentInput, lookups: Lookups, before?: DbEquipment) {
  assertActive(lookups.part_numbers, input.part_number_id, 'part_number_id', before?.part_number_id);
  assertActive(lookups.levels, input.level_id, 'level_id', before?.level_id);
  assertActive(lookups.locations, input.location_id, 'location_id', before?.location_id);
  assertTags(lookups, input.tag_ids);
}

/**
 * Thêm thiết bị. Có cha thì vị trí và Level lấy theo cha (bỏ qua giá trị gửi lên) và Status theo cha (database); không có cha
 * thì Location và Level bắt buộc (Type luôn theo part number).
 * Serial trùng chỉ cảnh báo — màn hình gọi serial-matches trước khi lưu, ở đây không chặn.
 */
export async function createEquipment(input: EquipmentInput, actor: string): Promise<EquipmentRow> {
  if (!input.serial_number) throw new AppError('VALIDATION_ERROR', { fields: { serial_number: 'required' } });
  if (!input.part_number_id) throw new AppError('VALIDATION_ERROR', { fields: { part_number_id: 'required' } });
  const { parent_id: parentId, ...sent } = input;
  const [lookups, parent] = await Promise.all([
    loadLookups(),
    parentId ? selectOne<DbEquipment>('equipment', parentId, 'id, location_id, level_id') : null,
  ]);
  let data: Record<string, unknown> = { ...sent };
  if (parentId) {
    if (!parent) throw new AppError('PARENT_NOT_FOUND', { fields: { parent_id: 'not_found' } });
    validate({ ...sent, location_id: undefined, level_id: undefined }, lookups);
    data = { ...sent, location_id: parent.location_id, level_id: parent.level_id, parent_id: parent.id };
  } else {
    if (!input.location_id) throw new AppError('VALIDATION_ERROR', { fields: { location_id: 'required' } });
    // Level bắt buộc khi không có cha (có cha thì Level theo cha). Database vẫn cho trống để không đụng dữ liệu cũ.
    if (!input.level_id) throw new AppError('VALIDATION_ERROR', { fields: { level_id: 'required' } });
    validate(sent, lookups);
  }
  const created = await appWrite<DbEquipment>('equipment', 'insert', null, data, actor);
  return getEquipment(created.id);
}

/**
 * Sửa thông tin.
 * - Thiết bị cha: đổi cha → Move (vị trí, Level, Status theo cha mới; cả cây con đi theo); bỏ trống → Detach
 *   (giữ vị trí, về Not in use). Quy tắc cây do database kiểm tra (PARENT_TYPE_INVALID…).
 * - Vị trí: có cha thì theo cha; không có cha thì Đổi vị trí (không đang In use; cả cây con đổi theo).
 * - Level: có cha (sau khi sửa) thì theo cha — giá trị gửi lên bị bỏ qua; không có cha thì sửa được, cây con đổi theo.
 * - Part number: chỉ đổi sang part number cùng Type (database: TYPE_KIND_INVALID).
 * Các bước chạy thử (dry run) trước khi ghi bất cứ thứ gì, để lỗi của Move / Đổi vị trí không để lại sửa dở.
 */
export async function updateEquipment(id: string, input: EquipmentInput, actor: string): Promise<EquipmentRow> {
  const [before, lookups] = await Promise.all([selectOne<DbEquipment>('equipment', id), loadLookups()]);
  if (!before) throw new AppError('NOT_FOUND');

  const { location_id, level_id: levelInput, parent_id: parentInput, ...fields } = input;
  const parentChanged = parentInput !== undefined && parentInput !== before.parent_id;
  const parentAfter = parentInput !== undefined ? parentInput : before.parent_id;
  const locationChanged = location_id !== undefined && location_id !== before.location_id;
  if (locationChanged && parentAfter && !parentChanged) throw new AppError('LOCATION_INHERITED_READ_ONLY');
  const setLocation = locationChanged && !parentAfter;
  // Không xóa trống Level của thiết bị không có cha (có cha thì giá trị gửi lên bị bỏ qua).
  if (levelInput === null && !parentAfter) throw new AppError('VALIDATION_ERROR', { fields: { level_id: 'required' } });
  const setLevel = levelInput !== undefined && levelInput !== before.level_id && !parentAfter;

  validate({ ...fields, location_id: setLocation ? location_id : undefined, level_id: setLevel ? levelInput : undefined }, lookups, before);
  if (parentChanged) {
    if (parentInput) await assetOps.move('equipment', id, parentInput, actor, true);
    else await assetOps.detach('equipment', id, actor, true);
  }
  if (setLocation && !parentChanged) await changeAssetLocation('equipment', id, location_id!, actor, true);

  const now = setLevel && !parentChanged ? { ...fields, level_id: levelInput } : fields;
  if (Object.keys(now).length) await appWrite('equipment', 'update', id, now, actor);
  if (parentChanged) {
    if (parentInput) await assetOps.move('equipment', id, parentInput, actor);
    else await assetOps.detach('equipment', id, actor);
  }
  if (setLevel && parentChanged) await appWrite('equipment', 'update', id, { level_id: levelInput }, actor);
  if (setLocation) await changeAssetLocation('equipment', id, location_id!, actor);
  return getEquipment(id);
}

type DbTreeRow = {
  asset_type: AssetType; id: string; kind: AssetKind; type_name: string | null; part_number: string | null; serial_number: string;
  usage: Usage; cal_status: CalibrationStatus | null; parent_id: string | null; depth: number; pos: number;
};

/**
 * Cây chứa thiết bị này, từ tài sản gốc (đi ngược theo cha) xuống mọi con cháu — cả sub-equipment và golden board
 * (docs/DETAIL_MODEL.md 4.1). Base / Fixture không có cha thì cây bắt đầu từ chính nó. MỘT lần gọi hàm asset_tree.
 */
export function equipmentTree(id: string): Promise<EquipmentTree> {
  return assetTree('equipment', id);
}

/** Cùng cây, hỏi từ bất kỳ tài sản nào của nó (Overview mở cây từ sub-equipment / golden board). */
export async function assetTree(type: AssetType, id: string): Promise<EquipmentTree> {
  const rows = await rpc<DbTreeRow[]>('asset_tree', { p_type: type, p_id: id }) ?? [];
  const root = rows.find((r) => r.depth === 0);
  if (!root) throw new AppError('NOT_FOUND');
  const nodes = [...rows].sort((a, b) => a.pos - b.pos).map((r): TreeNode => ({
    asset_type: r.asset_type, id: r.id, kind: r.kind, parent_id: r.parent_id, part_number: r.part_number,
    serial_number: r.serial_number, type_name: r.type_name, usage: r.usage, cal_status: r.cal_status,
  }));
  return { root_id: root.id, nodes };
}

export function equipmentHistory(id: string): Promise<HistoryEntry[]> {
  return assetLog('equipment', id);
}
