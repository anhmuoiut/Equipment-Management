import 'server-only';

/**
 * Phần dùng chung của ba loại tài sản (equipment, sub_equipment, golden_board) — docs/DATABASE.md
 * "Cây tài sản", "Hàm thao tác", "Tra cứu cho màn hình thao tác", asset_logs.
 *
 * Quy tắc nằm ở database (the baseline migration); chỗ này chỉ gọi hàm, kiểm tra giá trị chọn và đổi kết quả sang
 * kiểu của ứng dụng. Mọi hàm thao tác nhận `dryRun`: true = chạy đúng như thật (cùng kiểm tra, cùng mã lỗi)
 * rồi hoàn tác — màn hình thao tác dùng cho mục "Kết quả".
 */
import { db, rpc, selectAll } from './db';
import { withActorNames } from './history';
import { assertActive, loadLookups } from './lookups';
import { AppError, mapRpcError } from '@/lib/errors';
import type {
  AssetOpResult, AssetType, EquipmentKind, HistoryChange, HistoryEntry, ParentCandidate, SerialMatch, SwapCandidate, Usage,
} from '@/lib/types';

export const ASSET_TYPES: readonly AssetType[] = ['equipment', 'sub_equipment', 'golden_board'];

/** Loại tài sản từ đường dẫn (/api/assets/[type]/…). Không nhận ra → NOT_FOUND. */
export function parseAssetType(value: string | null | undefined): AssetType {
  if (!ASSET_TYPES.includes(value as AssetType)) throw new AppError('NOT_FOUND');
  return value as AssetType;
}

// ---------------------------------------------------------------- Thao tác
const op = (fn: string, args: Record<string, unknown>) => rpc<AssetOpResult>(fn, args);

export const assetOps = {
  /** Chỉ tài sản chưa gắn cha, không đang In use. Con cháu đi theo. */
  changeLocation: (type: AssetType, id: string, locationId: string, actor: string, dryRun = false) =>
    op('asset_change_location', { p_type: type, p_id: id, p_location_id: locationId, p_actor: actor, p_dry_run: dryRun }),
  /** Gắn vào cha / đổi cha — luôn được (theo quy tắc cây); tài sản và con cháu lấy Status của cha mới. */
  move: (type: AssetType, id: string, parentId: string, actor: string, dryRun = false) =>
    op('asset_move', { p_type: type, p_id: id, p_parent_id: parentId, p_actor: actor, p_dry_run: dryRun }),
  /** Tách khỏi cha (được cả khi In use): về Not in use. */
  detach: (type: AssetType, id: string, actor: string, dryRun = false) =>
    op('asset_detach', { p_type: type, p_id: id, p_actor: actor, p_dry_run: dryRun }),
  /** Đổi chỗ hai tài sản cùng loại (cùng Type với equipment / sub-equipment; golden board bất kỳ). */
  swap: (type: AssetType, a: string, b: string, actor: string, dryRun = false) =>
    op('asset_swap', { p_type: type, p_a: a, p_b: b, p_actor: actor, p_dry_run: dryRun }),
  /** Xóa thật. Con trực tiếp được giữ lại, thành chưa gắn (Not in use). Không xóa tài sản đang In use. */
  remove: (type: AssetType, id: string, actor: string, dryRun = false) =>
    op('asset_delete', { p_type: type, p_id: id, p_actor: actor, p_dry_run: dryRun }),
  /** Check-out (in_use) / Check-in (not_in_use) các tài sản được chọn và toàn bộ con cháu — một giao dịch. */
  setUsage: (refs: { type: AssetType; id: string }[], usage: Usage, note: string | null, actor: string, dryRun = false) =>
    op('asset_set_usage', { p_refs: refs, p_usage: usage, p_actor: actor, p_note: note, p_dry_run: dryRun }),
};

/** Đổi vị trí: vị trí mới phải còn đang dùng (is_active). */
export async function changeAssetLocation(type: AssetType, id: string, locationId: string, actor: string, dryRun = false) {
  assertActive((await loadLookups()).locations, locationId, 'location_id');
  return assetOps.changeLocation(type, id, locationId, actor, dryRun);
}

/**
 * Đổi cha / vị trí của một tài sản khi sửa form: `parentTo` = id cha mới, null = tách khỏi cha, undefined = không đổi;
 * `location` = vị trí mới (chỉ áp dụng khi không có cha sau khi sửa). Cha trước, vị trí sau — như thứ tự thao tác thật.
 */
export type TreeEdit = { parentTo?: string | null; location?: string };

/** Chạy thử (dry run) các bước của TreeEdit để lỗi của Move / Đổi vị trí báo trước khi ghi bất cứ thứ gì. */
export async function previewTreeEdit(type: AssetType, id: string, edit: TreeEdit, actor: string): Promise<void> {
  if (edit.parentTo !== undefined) {
    if (edit.parentTo) await assetOps.move(type, id, edit.parentTo, actor, true);
    else await assetOps.detach(type, id, actor, true);
  } else if (edit.location) {
    await changeAssetLocation(type, id, edit.location, actor, true);
  }
}

export async function applyTreeEdit(type: AssetType, id: string, edit: TreeEdit, actor: string): Promise<void> {
  if (edit.parentTo !== undefined) {
    if (edit.parentTo) await assetOps.move(type, id, edit.parentTo, actor);
    else await assetOps.detach(type, id, actor);
  }
  if (edit.location) await changeAssetLocation(type, id, edit.location, actor);
}

// ---------------------------------------------------------------- Tra cứu
/** Cha hợp lệ để gắn vào (ô "Thiết bị cha" / "Tester" / "Gắn vào" và màn hình Move). Thêm mới: truyền `kind` thay cho `id`. */
export async function validParents(
  type: AssetType, o: { id?: string | null; kind?: EquipmentKind | null; q?: string | null; limit?: number } = {},
): Promise<ParentCandidate[]> {
  return await rpc<ParentCandidate[]>('valid_parents', {
    p_type: type, p_id: o.id ?? null, p_kind: o.kind ?? null, p_q: o.q ?? null, p_limit: o.limit ?? 50,
  }) ?? [];
}

/** Tài sản có thể Swap với `id` (màn hình Swap chỉ liệt kê các dòng này). */
export async function swapCandidates(type: AssetType, id: string, q?: string | null, limit = 50): Promise<SwapCandidate[]> {
  return await rpc<SwapCandidate[]>('swap_candidates', { p_type: type, p_id: id, p_q: q ?? null, p_limit: limit }) ?? [];
}

/** Tài sản ở cả ba bảng có cùng serial — popup cảnh báo trước khi lưu (vẫn lưu được). */
export async function serialMatches(serial: string, exclude?: { type: AssetType; id: string }): Promise<SerialMatch[]> {
  if (!serial.trim()) return [];
  return await rpc<SerialMatch[]>('serial_matches', {
    p_serial: serial, p_exclude_type: exclude?.type ?? null, p_exclude_id: exclude?.id ?? null,
  }) ?? [];
}

/**
 * Id các equipment đang có con là sub-equipment hoặc golden board — nửa còn lại của cờ "có con" trong danh sách Equipment
 * (con là equipment thì chính danh sách đó đã có `parent_id`, không cần đọc bảng equipment thêm lần nữa).
 */
export async function equipmentWithLeafChildren(): Promise<Set<string>> {
  const [subs, golden] = await Promise.all([
    selectAll<{ tester_id: string | null }>('sub_equipment', 'tester_id'),
    selectAll<{ parent_id: string | null }>('golden_boards', 'parent_id'),
  ]);
  const out = new Set<string>();
  subs.forEach((r) => { if (r.tester_id) out.add(r.tester_id); });
  golden.forEach((r) => { if (r.parent_id) out.add(r.parent_id); });
  return out;
}

// ------------------------------------------------------------------ Nhật ký
type DbLog = {
  id: string; label: string; action: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null;
  from_location: string | null; to_location: string | null; reason: string | null; source: string;
  user_id: string | null; created_at: string;
};

/** old_value / new_value của asset_logs → { trường: { old, new } } (giống hàm asset_log_changes của database). */
export function logChanges(oldValue: Record<string, unknown> | null, newValue: Record<string, unknown> | null): Record<string, HistoryChange> {
  const out: Record<string, HistoryChange> = {};
  for (const key of new Set([...Object.keys(oldValue ?? {}), ...Object.keys(newValue ?? {})])) {
    out[key] = { old: oldValue?.[key] ?? null, new: newValue?.[key] ?? null };
  }
  return out;
}

const LOG_COLUMNS = 'id, label, action, old_value, new_value, from_location, to_location, reason, source, user_id, created_at';

/** Tab Lịch sử của một tài sản (mới nhất lên đầu). `actions`: chỉ các hành động này (ví dụ chỉ CALIBRATE). */
export async function assetLog(type: AssetType, id: string, actions?: readonly string[], limit = 500): Promise<HistoryEntry[]> {
  let query = db().from('asset_logs').select(LOG_COLUMNS)
    .eq('asset_type', type).eq('asset_id', id)
    .order('created_at', { ascending: false }).order('id').limit(limit);
  if (actions?.length) query = query.in('action', [...actions]);
  const { data, error } = await query;
  if (error) throw mapRpcError(error);
  const rows = ((data ?? []) as DbLog[]).map((r) => ({
    id: r.id, label: r.label, action: r.action, changes: logChanges(r.old_value, r.new_value),
    note: r.reason, source: r.source, created_at: r.created_at, created_by: r.user_id,
    from_location: r.from_location, to_location: r.to_location,
  }));
  return withActorNames(rows);
}
