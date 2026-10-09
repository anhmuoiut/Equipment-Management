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
  AssetType, CalibrationAlert, CalibrationStatus, CountItem, DashboardData, HistoryModule, RecentActivity, StatusColor,
  StatusCountItem, Usage,
} from '@/lib/types';

type Basic = { usage: Usage; location_id: string; tag_ids: string[] | null };
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

  const alert = (s: DbSub, status: CalibrationStatus, due: string | null): CalibrationAlert => ({
    id: s.id, serial_number: s.serial_number, part_number: nameOf(lookups.part_numbers, s.part_number_id),
    type: nameOf(lookups.types, s.type_id), tester_serial: s.tester?.serial_number ?? null,
    location: nameOf(lookups.locations, s.location_id), due_date: due, status,
  });
  const alerts = (which: CalibrationStatus) => subs
    .filter((s) => statusOf.get(s.id)?.status === which)
    .map((s) => alert(s, which, statusOf.get(s.id)?.due_date ?? null))
    .sort(byDue);

  const usage = (rows: Basic[]) => countByStatus(USAGE_STATUSES, USAGE_STATUS_COLOR, rows.map((r) => r.usage));
  const all = [...equipment, ...subs, ...golden];
  const tagCounts = countBy(all.flatMap((r) => r.tag_ids ?? []), (id) => (id ? lookups.tags.get(id)?.display_name ?? null : null))
    .filter((t) => t.label !== null);

  return {
    equipment_total: equipment.length,
    sub_equipment_total: subs.length,
    golden_total: golden.length,
    by_usage: { equipment: usage(equipment), sub_equipment: usage(subs), golden_board: usage(golden) } satisfies Record<AssetType, StatusCountItem[]>,
    by_calibration_status: countByStatus(
      CALIBRATION_STATUSES, CALIBRATION_STATUS_COLOR, subs.map((s) => statusOf.get(s.id)?.status ?? 'not_calibrated')),
    by_tag: tagCounts,
    by_location: countBy(all.map((r) => r.location_id), (id) => nameOf(lookups.locations, id)),
    by_type: countBy([...equipment, ...subs].map((r) => r.type_id), (id) => nameOf(lookups.types, id)),
    overdue: alerts('overdue'),
    due_soon: alerts('due_soon'),
  };
}

export type ActivityFilter = { module?: HistoryModule; userId?: string; search?: string; from?: string; to?: string; limit?: number };

/** Thay đổi gần đây (view recent_activities; một lần import = một dòng). Configuration / User chỉ Admin thấy. */
export async function recentActivities(role: Role, filter: ActivityFilter): Promise<RecentActivity[]> {
  let query = db().from('recent_activities')
    .select('module, object_id, label, action, changes, created_by, created_at, note, source, item_count')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 500));
  if (role !== 'admin') query = query.in('module', ['equipment', 'sub_equipment', 'golden_board']);
  if (filter.module) query = query.eq('module', filter.module);
  if (filter.userId) query = query.eq('created_by', filter.userId);
  // Tìm theo tên / serial (label), không phân biệt hoa thường; % _ trong chữ gõ vào là ký tự thường.
  if (filter.search) query = query.ilike('label', `%${filter.search.replace(/[\\%_]/g, '\\$&')}%`);
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.to) query = query.lte('created_at', filter.to);
  const { data, error } = await query;
  if (error) throw mapRpcError(error);
  const rows = await withActorNames((data ?? []) as Omit<RecentActivity, 'created_by_name' | 'id'>[]);
  return rows.map((r, i) => ({ ...r, id: `${r.object_id}-${r.created_at}-${i}` }));
}
