import 'server-only';

/**
 * Dashboard — không có bảng riêng, chỉ đọc từ các module (docs/DATABASE.md): số lượng theo Status
 * (Equipment, Sub-equipment, Golden board) và Calibration Status, theo thẻ / vị trí / loại, sub-equipment quá hạn và sắp
 * đến hạn hiệu chuẩn, thay đổi gần đây.
 */
import { db, rpc } from './core/db';
import { withActorNames } from './core/history';
import { loadLookups, nameOf } from './core/lookups';
import { mapRpcError } from '@/lib/errors';
import { CALIBRATION_STATUSES, CALIBRATION_STATUS_COLOR, USAGE_STATUSES, USAGE_STATUS_COLOR } from '@/lib/status';
import type { Role } from '@/lib/permissions';
import type {
  ActionRecord, AssetType, CalibrationAlert, CalibrationStatus, CountItem, DashboardData, HistoryModule, RecentAction, StatusColor,
  StatusCountItem, Usage,
} from '@/lib/types';

/** Một dòng của danh sách Quá hạn / Sắp đến hạn do hàm dashboard_summary trả (chỉ id — tên do server ghép từ Configuration đã nhớ). */
type DueRow = {
  id: string; serial_number: string; part_number_id: string; type_id: string; location_id: string;
  tester_serial: string | null; due_date: string | null; status: CalibrationStatus;
};
type Counted = { id: string | null; count: number };
/** Kết quả của hàm dashboard_summary (migration 20261016000000). */
type Summary = {
  totals: Record<AssetType, number>;
  usage: Record<AssetType, Record<Usage, number>>;
  calibration: Partial<Record<CalibrationStatus, number>>;
  locations: Counted[];
  types: Counted[];
  tags: Counted[];
  untagged: number;
  overdue: DueRow[];
  due_soon: DueRow[];
};

/** Dashboard chỉ vẽ vài dòng đầu của mỗi danh sách (15 trên máy tính, 5 trên điện thoại); số đầy đủ lấy từ `calibration`. */
const DUE_LIST_LIMIT = 15;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Nhiều nhất trước; bằng nhau thì theo tên (không có tên — "No type", "Untagged" — xếp cuối) cho thứ tự ổn định. */
function ranked(items: CountItem[]): CountItem[] {
  return items.sort((x, y) => y.count - x.count || collator.compare(x.label ?? '\uffff', y.label ?? '\uffff'));
}

/**
 * Đếm theo Status (do hệ thống quản, thứ tự và màu cố định): mỗi Status luôn ở cùng một chỗ, kể cả khi
 * số lượng là 0. `label` để trống — màn hình dịch `id` ra chữ.
 */
function countByStatus<K extends string>(keys: readonly K[], color: Record<K, StatusColor>, counts: Partial<Record<K, number>>): StatusCountItem[] {
  return keys.map((key) => ({ id: key, label: null, color: color[key], count: counts[key] ?? 0 }));
}

/**
 * Mọi con số của Dashboard đến từ MỘT lần gọi hàm dashboard_summary (đếm ở database, vài KB) — không còn đọc cả ba bảng tài sản và view
 * Calibration về để đếm trong JavaScript. MỘT nguồn cho mọi con số hiệu chuẩn: số theo Calibration Status, hai danh sách Quá hạn / Sắp đến
 * hạn và các KPI đều từ cùng view sub_equipment_calibration trong cùng câu truy vấn — không thể lệch nhau.
 */
export async function getDashboard(): Promise<DashboardData> {
  const [summary, lookups] = await Promise.all([
    rpc<Summary>('dashboard_summary', { p_list_limit: DUE_LIST_LIMIT }),
    loadLookups(),
  ]);

  const alert = (row: DueRow): CalibrationAlert => ({
    id: row.id, serial_number: row.serial_number, part_number: nameOf(lookups.part_numbers, row.part_number_id),
    type: nameOf(lookups.types, row.type_id), tester_serial: row.tester_serial,
    location: nameOf(lookups.locations, row.location_id), due_date: row.due_date, status: row.status,
  });
  const usage = (counts: Record<Usage, number>) => countByStatus(USAGE_STATUSES, USAGE_STATUS_COLOR, counts);
  // Location / Type / Tag cùng một phạm vi: TẤT CẢ tài sản (Equipment + Sub-equipment + Golden board), mỗi tài sản đếm một lần.
  // Tài sản không có Type (golden board) và tài sản chưa gắn thẻ có dòng riêng (id = null) để tổng các dòng luôn bằng tổng tài sản.
  const named = (rows: Counted[], names: Map<string, { display_name: string }>): CountItem[] =>
    rows.map((r) => ({ id: r.id, label: nameOf(names, r.id), count: r.count }));

  return {
    equipment_total: summary.totals.equipment,
    sub_equipment_total: summary.totals.sub_equipment,
    golden_total: summary.totals.golden_board,
    by_usage: {
      equipment: usage(summary.usage.equipment), sub_equipment: usage(summary.usage.sub_equipment), golden_board: usage(summary.usage.golden_board),
    } satisfies Record<AssetType, StatusCountItem[]>,
    by_calibration_status: countByStatus(CALIBRATION_STATUSES, CALIBRATION_STATUS_COLOR, summary.calibration),
    by_tag: ranked([
      ...named(summary.tags, lookups.tags),
      ...(summary.untagged > 0 ? [{ id: null, label: null, count: summary.untagged }] : []),
    ]),
    by_location: ranked(named(summary.locations, lookups.locations)),
    by_type: ranked(named(summary.types, lookups.types)),
    overdue: summary.overdue.map(alert),
    due_soon: summary.due_soon.map(alert),
  };
}

export type ActivityFilter = {
  module?: HistoryModule; userId?: string; search?: string; from?: string; to?: string;
  /** Số thao tác một trang (tối đa MAX_ACTIVITY_PAGE). */
  limit?: number;
  /** Bỏ qua bấy nhiêu thao tác đầu (trang kế tiếp: offset = số thao tác đã có). */
  offset?: number;
};

/** Một trang "Thay đổi gần đây" tối đa bấy nhiêu thao tác; xem tiếp bằng `offset`. */
export const MAX_ACTIVITY_PAGE = 100;
const MAX_ACTIVITY_OFFSET = 10_000;

const ASSET_MODULES: HistoryModule[] = ['equipment', 'sub_equipment', 'golden_board'];
/**
 * Module mà "Thay đổi gần đây" của Dashboard liệt kê: ba module tài sản cho mọi người, thêm User Management (tạo / sửa / khóa tài khoản) cho Admin.
 * Thay đổi Configuration không hiện ở đây cho ai cả (từ migration 20261017000000 chúng cũng không còn được ghi); lọc cả ở đây để một database chưa
 * chạy migration đó vẫn không lộ chúng.
 */
const visibleModules = (role: Role): HistoryModule[] => (role === 'admin' ? [...ASSET_MODULES, 'user'] : ASSET_MODULES);
/** % _ \ trong chữ gõ vào là ký tự thường (ilike). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Thay đổi gần đây, MỘT thao tác của người dùng = MỘT dòng (view recent_actions, gộp theo action_id). Mọi bộ lọc và giới hạn tính trên
 * THAO TÁC đã gộp, không phải dòng nhật ký: module = thao tác có chạm bản ghi của module đó; tìm chữ = khớp tên / serial của BẤT KỲ bản
 * ghi nào trong thao tác. User Management chỉ Admin thấy; Configuration không hiện ở đây (xem visibleModules).
 */
export async function recentActivities(role: Role, filter: ActivityFilter): Promise<RecentAction[]> {
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 50), 1), MAX_ACTIVITY_PAGE);
  const offset = Math.min(Math.max(Math.floor(filter.offset ?? 0), 0), MAX_ACTIVITY_OFFSET);
  let query = db().from('recent_actions')
    .select('id, module, modules, action, source, created_by, created_at, item_count, records')
    .order('created_at', { ascending: false }).order('id')
    .range(offset, offset + limit - 1);
  query = query.containedBy('modules', visibleModules(role));
  if (filter.module) query = query.contains('modules', [filter.module]);
  if (filter.userId) query = query.eq('created_by', filter.userId);
  if (filter.search) query = query.ilike('search_text', likePattern(filter.search));
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.to) query = query.lte('created_at', filter.to);
  const { data, error } = await query;
  // TẠM THỜI: database dựng trước baseline (project cũ) chưa có view recent_actions → dùng view cũ. Xem docs/DEPLOY.md §8.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return legacyActivities(role, filter, limit, offset);
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

async function legacyActivities(role: Role, filter: ActivityFilter, limit: number, offset: number): Promise<RecentAction[]> {
  // Bộ lọc cùng một giá trị cho mọi dòng của một thao tác (người, thời gian) lọc ở database; module / chữ tìm lọc sau khi gộp.
  let query = db().from('recent_activities')
    .select('module, object_id, label, action, changes, created_by, created_at, note, source, item_count')
    .order('created_at', { ascending: false })
    .limit(LEGACY_ROWS);
  query = query.in('module', visibleModules(role));
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
    .filter((a) => a.modules.every((m) => visibleModules(role).includes(m)))
    .slice(offset, offset + limit);
  return withActorNames(visible.map(({ labels: _labels, ...action }) => action));
}
