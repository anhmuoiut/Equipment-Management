import 'server-only';

/**
 * Dashboard — không có bảng riêng, chỉ đọc từ các module (docs/DATABASE_MODIFIED.md mục 1): số lượng theo Status
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
  AssetType, CalibrationAlert, CalibrationStatus, CountItem, DashboardData, HistoryModule, RecentAction, StatusColor,
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
  if (error) throw mapRpcError(error);
  return withActorNames((data ?? []) as Omit<RecentAction, 'created_by_name'>[]);
}
