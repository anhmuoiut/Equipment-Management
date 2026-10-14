import 'server-only';

/**
 * Dashboard — không có bảng riêng, chỉ đọc từ các module (docs/DATABASE.md): số lượng theo Status
 * (Equipment, Sub-equipment, Golden board) và Calibration Status, theo thẻ / vị trí / loại, sub-equipment quá hạn và sắp
 * đến hạn hiệu chuẩn, thay đổi gần đây.
 */
import { db, selectAll } from './core/db';
import { withActorNames } from './core/history';
import { loadLookups, nameOf } from './core/lookups';
import { mapRpcError } from '@/lib/errors';
import { CALIBRATION_STATUSES, CALIBRATION_STATUS_COLOR, USAGE_STATUSES, USAGE_STATUS_COLOR } from '@/lib/status';
import type { Role } from '@/lib/permissions';
import type {
  ActionRecord, AssetType, CalibrationAlert, CalibrationStatus, CountItem, DashboardData, HistoryModule, RecentAction, StatusColor,
  StatusCountItem, Usage,
} from '@/lib/types';

/** `type_id` chỉ có ở equipment / sub-equipment — golden board không có Type. */
type Basic = { usage: Usage; location_id: string; tag_ids: string[] | null; type_id?: string | null };
type DbSub = Basic & {
  id: string; serial_number: string; part_number_id: string; type_id: string; tester_id: string | null; tester: { serial_number: string } | null;
};

function countBy(keys: (string | null)[], label: (id: string | null) => string | null): CountItem[] {
  const counts = new Map<string | null, number>();
  keys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: label(id), count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Đếm theo Status (do hệ thống quản, thứ tự và màu cố định): mỗi Status luôn ở cùng một chỗ, kể cả khi
 * số lượng là 0. `label` để trống — màn hình dịch `id` ra chữ.
 */
function countByStatus<K extends string>(keys: readonly K[], color: Record<K, StatusColor>, values: K[]): StatusCountItem[] {
  return keys.map((key) => ({ id: key, label: null, color: color[key], count: values.filter((v) => v === key).length }));
}

const byDue = (a: CalibrationAlert, b: CalibrationAlert) => (a.due_date ?? '').localeCompare(b.due_date ?? '');

export async function getDashboard(): Promise<DashboardData> {
  const [equipment, subs, golden, statuses, lookups] = await Promise.all([
    selectAll<Basic & { id: string; type_id: string }>('equipment', 'id, usage, location_id, type_id, tag_ids'),
    selectAll<DbSub>('sub_equipment', 'id, serial_number, part_number_id, type_id, tester_id, usage, location_id, tag_ids, tester:tester_id(serial_number)'),
    selectAll<Basic & { id: string }>('golden_boards', 'id, usage, location_id, tag_ids'),
    selectAll<{ sub_equipment_id: string; due_date: string | null; status: CalibrationStatus }>(
      'sub_equipment_calibration', 'sub_equipment_id, due_date, status', 'sub_equipment_id'),
    loadLookups(),
  ]);

  const statusOf = new Map(statuses.map((s) => [s.sub_equipment_id, s]));
  // MỘT nguồn cho mọi con số hiệu chuẩn: Calibration Status của từng sub-equipment được tính đúng một lần ở đây, rồi cả số đếm theo
  // Status lẫn hai danh sách Quá hạn / Sắp đến hạn (và các KPI) đều lấy từ nó — không thể lệch nhau.
  const statusFor = (s: DbSub): CalibrationStatus => statusOf.get(s.id)?.status ?? 'not_calibrated';

  const alert = (s: DbSub, status: CalibrationStatus, due: string | null): CalibrationAlert => ({
    id: s.id, serial_number: s.serial_number, part_number: nameOf(lookups.part_numbers, s.part_number_id),
    type: nameOf(lookups.types, s.type_id), tester_serial: s.tester?.serial_number ?? null,
    location: nameOf(lookups.locations, s.location_id), due_date: due, status,
  });
  const alerts = (which: CalibrationStatus) => subs
    .filter((s) => statusFor(s) === which)
    .map((s) => alert(s, which, statusOf.get(s.id)?.due_date ?? null))
    .sort(byDue);

  const usage = (rows: Basic[]) => countByStatus(USAGE_STATUSES, USAGE_STATUS_COLOR, rows.map((r) => r.usage));
  // Location / Type / Tag cùng một phạm vi: TẤT CẢ tài sản (Equipment + Sub-equipment + Golden board), mỗi tài sản đếm một lần.
  // Tài sản không có Type (golden board) và tài sản chưa gắn thẻ có dòng riêng (id = null) để tổng các dòng luôn bằng tổng tài sản.
  const all: Basic[] = [...equipment, ...subs, ...golden];
  const tagsOf = (r: Basic) => (r.tag_ids ?? []).filter((id) => lookups.tags.has(id));
  const tagCounts = countBy(all.flatMap(tagsOf), (id) => (id ? lookups.tags.get(id)?.display_name ?? null : null));
  const untagged = all.filter((r) => tagsOf(r).length === 0).length;

  return {
    equipment_total: equipment.length,
    sub_equipment_total: subs.length,
    golden_total: golden.length,
    by_usage: { equipment: usage(equipment), sub_equipment: usage(subs), golden_board: usage(golden) } satisfies Record<AssetType, StatusCountItem[]>,
    by_calibration_status: countByStatus(CALIBRATION_STATUSES, CALIBRATION_STATUS_COLOR, subs.map(statusFor)),
    by_tag: (untagged > 0 ? [...tagCounts, { id: null, label: null, count: untagged }] : tagCounts).sort((a, b) => b.count - a.count),
    by_location: countBy(all.map((r) => r.location_id), (id) => nameOf(lookups.locations, id)),
    by_type: countBy(all.map((r) => r.type_id ?? null), (id) => nameOf(lookups.types, id)),
    overdue: alerts('overdue'),
    due_soon: alerts('due_soon'),
  };
}

export type ActivityFilter = { module?: HistoryModule; userId?: string; search?: string; from?: string; to?: string; limit?: number };

const ASSET_MODULES: HistoryModule[] = ['equipment', 'sub_equipment', 'golden_board'];
/** % _ \ trong chữ gõ vào là ký tự thường (ilike). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Thay đổi gần đây, MỘT thao tác của người dùng = MỘT dòng (view recent_actions, gộp theo action_id). Mọi bộ lọc và giới hạn tính trên
 * THAO TÁC đã gộp, không phải dòng nhật ký: module = thao tác có chạm bản ghi của module đó; tìm chữ = khớp tên / serial của BẤT KỲ bản
 * ghi nào trong thao tác. Configuration / User chỉ Admin thấy.
 */
export async function recentActivities(role: Role, filter: ActivityFilter): Promise<RecentAction[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  let query = db().from('recent_actions')
    .select('id, module, modules, action, source, created_by, created_at, item_count, records')
    .order('created_at', { ascending: false }).order('id')
    .limit(limit);
  if (role !== 'admin') query = query.containedBy('modules', ASSET_MODULES);
  if (filter.module) query = query.contains('modules', [filter.module]);
  if (filter.userId) query = query.eq('created_by', filter.userId);
  if (filter.search) query = query.ilike('search_text', likePattern(filter.search));
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.to) query = query.lte('created_at', filter.to);
  const { data, error } = await query;
  // TẠM THỜI: database dựng trước baseline (project cũ) chưa có view recent_actions → dùng view cũ. Xem docs/DEPLOY.md §8.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return legacyActivities(role, filter, limit);
  if (error) throw mapRpcError(error);
  return withActorNames((data ?? []) as Omit<RecentAction, 'created_by_name'>[]);
}

/**
 * TẠM THỜI — chỉ để app chạy được trên database dựng TRƯỚC baseline (project cũ), nơi chưa có cột action_id. Database baseline không
 * có view recent_activities và không bao giờ vào đây; bỏ hàm này cùng `callRpc` retry trong db.ts khi không còn môi trường nào dùng
 * schema cũ (docs/DEPLOY.md §8).
 *
 * Không có action_id thì dùng cái thay thế được: mọi dòng nhật ký của MỘT thao tác nằm trong MỘT giao dịch, nên `created_at`
 * (= now() của giao dịch) giống hệt nhau, cùng người, cùng nguồn. Gộp theo bộ ba đó cho ra đúng một dòng cho một Swap / Move / Check-out
 * kèm con cháu. Chỉ chưa gộp được: một lần lưu form gồm NHIỀU lời gọi database (nhiều giao dịch) — cần action_id của baseline.
 */
const LEGACY_ROWS = 1000;
const FOLLOWER = /^(via_parent|parent_deleted):/;

async function legacyActivities(role: Role, filter: ActivityFilter, limit: number): Promise<RecentAction[]> {
  // Bộ lọc cùng một giá trị cho mọi dòng của một thao tác (người, thời gian) lọc ở database; module / chữ tìm lọc sau khi gộp.
  let query = db().from('recent_activities')
    .select('module, object_id, label, action, changes, created_by, created_at, note, source, item_count')
    .order('created_at', { ascending: false })
    .limit(LEGACY_ROWS);
  if (role !== 'admin') query = query.in('module', ASSET_MODULES);
  if (filter.userId) query = query.eq('created_by', filter.userId);
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.to) query = query.lte('created_at', filter.to);
  const { data, error } = await query;
  if (error) throw mapRpcError(error);

  type Row = Omit<ActionRecord, 'from_location' | 'to_location'> & { created_by: string | null; created_at: string; source: string; item_count: number };
  const rows = (data ?? []) as Row[];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.created_at}|${r.created_by ?? ''}|${r.source}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  let ordered = [...groups.entries()];
  // Đọc kín LEGACY_ROWS dòng thì thao tác cũ nhất có thể bị cắt dở: bỏ nó thay vì hiện một thao tác thiếu bản ghi.
  if (rows.length >= LEGACY_ROWS && ordered.length > 1) ordered = ordered.slice(0, -1);

  const actions = ordered.map(([key, group]) => {
    // Bản ghi chính (do người dùng chọn) trước, bản ghi đi theo (via_parent / parent_deleted) sau; trong mỗi nhóm theo tên cho ổn định.
    const sorted = [...group].sort((a, b) => Number(FOLLOWER.test(a.note ?? '')) - Number(FOLLOWER.test(b.note ?? '')) || a.label.localeCompare(b.label));
    const lead = sorted[0]!;
    return {
      id: `legacy:${key}`, module: lead.module, modules: [...new Set(sorted.map((r) => r.module))], action: lead.action, source: lead.source,
      created_by: lead.created_by, created_at: lead.created_at,
      item_count: sorted.reduce((sum, r) => sum + r.item_count, 0),
      // Một lần import cũ chỉ có một dòng đại diện (item_count > 1): không liệt kê (như trước).
      records: sorted.filter((r) => r.item_count === 1).slice(0, 50)
        .map((r): ActionRecord => ({ module: r.module, object_id: r.object_id, label: r.label, action: r.action, changes: r.changes, note: r.note })),
      labels: sorted.map((r) => r.label.toLowerCase()),
    };
  });

  const needle = filter.search?.trim().toLowerCase();
  const visible = actions
    .filter((a) => !filter.module || a.modules.includes(filter.module))
    .filter((a) => !needle || a.labels.some((label) => label.includes(needle)))
    .filter((a) => role === 'admin' || a.modules.every((m) => ASSET_MODULES.includes(m)))
    .slice(0, limit);
  return withActorNames(visible.map(({ labels: _labels, ...action }) => action));
}
