import 'server-only';

/**
 * Truy cập database dùng chung cho mọi module.
 *
 * - selectAll: đọc hết một bảng (Supabase trả tối đa 1000 dòng mỗi lần).
 * - appWrite: mọi thêm / sửa / xóa đi qua RPC app_write (database/migrations, file baseline)
 *   để lịch sử được ghi trong cùng giao dịch, kèm người thao tác.
 * - rpc: gọi các thao tác nhiều bước (Move, Swap…).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError, mapRpcError } from '@/lib/errors';
import { currentActionId } from './actionContext';
import { invalidateLookups, LOOKUP_TABLES } from './lookupCache';

export const db = supabaseAdmin;

/** Hàm GHI dữ liệu của database có tham số `p_action_id` (migration baseline). Hàm tra cứu (valid_parents, asset_tree…) không có. */
const ACTION_RPCS = new Set([
  'app_write', 'asset_change_location', 'asset_move', 'asset_detach', 'asset_swap', 'asset_delete', 'asset_set_usage',
  'equipment_import', 'sub_equipment_import', 'golden_import',
]);

/** Mọi dòng nhật ký do cùng một request ghi ra dùng chung một `p_action_id` (xem actionContext.ts). */
function callRpc(fn: string, args: Record<string, unknown>) {
  const actionId = ACTION_RPCS.has(fn) ? currentActionId() : undefined;
  return db().rpc(fn, actionId ? { ...args, p_action_id: actionId } : args);
}

const PAGE = 1000;

/**
 * Trang đầu kèm tổng số dòng: bảng lớn hơn một trang thì các trang còn lại tải SONG SONG (trước đây lần lượt từng
 * trang, mỗi trang một vòng mạng). Không có tổng số (null) thì quay về đọc lần lượt cho tới khi hết.
 */
export async function selectAll<T>(table: string, columns = '*', order = 'id'): Promise<T[]> {
  const page = async (from: number, count?: 'exact') => {
    const { data, error, count: total } = await db().from(table).select(columns, count ? { count } : undefined)
      .order(order).range(from, from + PAGE - 1);
    if (error) throw mapRpcError(error);
    return { rows: (data ?? []) as T[], total: total ?? null };
  };
  const first = await page(0, 'exact');
  if (first.rows.length < PAGE) return first.rows;

  const out = first.rows;
  if (first.total !== null) {
    const starts = Array.from({ length: Math.ceil((first.total - PAGE) / PAGE) }, (_, i) => (i + 1) * PAGE);
    for (const part of await Promise.all(starts.map((from) => page(from)))) out.push(...part.rows);
    return out;
  }
  for (let from = PAGE; ; from += PAGE) {
    const { rows } = await page(from);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function selectOne<T>(table: string, id: string, columns = '*'): Promise<T | null> {
  const { data, error } = await db().from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw mapRpcError(error);
  return (data as T | null) ?? null;
}

export type WriteOptions = { action?: string; note?: string; source?: 'ui' | 'import' | 'script' };

export async function appWrite<T = Record<string, unknown>>(
  table: string,
  op: 'insert' | 'update' | 'delete',
  id: string | null,
  data: Record<string, unknown> | null,
  actor: string | null,
  options: WriteOptions = {},
): Promise<T> {
  const { data: result, error } = await callRpc('app_write', {
    p_table: table,
    p_op: op,
    p_id: id,
    p_data: data,
    p_actor: actor,
    p_action: options.action ?? null,
    p_note: options.note ?? null,
    p_source: options.source ?? 'ui',
  });
  // Sau MỌI lần ghi (kể cả lỗi — an toàn hơn đoán): dữ liệu gốc dùng chung đọc lại ở lần dùng kế tiếp (lookupCache.ts).
  if (LOOKUP_TABLES.has(table)) invalidateLookups();
  if (error) throw mapRpcError(error);
  if (!result) throw new AppError('NOT_FOUND');
  return result as T;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await callRpc(fn, args);
  if (error) throw mapRpcError(error);
  return data as T;
}
