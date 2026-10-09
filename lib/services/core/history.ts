import 'server-only';

/**
 * Đọc bảng <module>_histories (tab Lịch sử) — mọi module dùng chung khuôn.
 * Ghi lịch sử do database tự làm (trigger write_history).
 */
import { db } from './db';
import { loadLookups } from './lookups';
import { mapRpcError } from '@/lib/errors';
import type { HistoryEntry } from '@/lib/types';

const COLUMNS = 'id, label, action, changes, note, source, created_at, created_by';

type Filter = { column: string; value: string };

export async function readHistory(table: string, filters: Filter[], limit = 500): Promise<HistoryEntry[]> {
  let query = db().from(table).select(COLUMNS).order('created_at', { ascending: false }).limit(limit);
  for (const f of filters) query = query.eq(f.column, f.value);
  const { data, error } = await query;
  if (error) throw mapRpcError(error);
  const rows = (data ?? []) as Omit<HistoryEntry, 'created_by_name'>[];
  return withActorNames(rows);
}

/** Tên người thao tác — lấy từ dữ liệu gốc dùng chung (đã nhớ), không đọc thêm bảng nào. */
export async function withActorNames<T extends { created_by: string | null }>(rows: T[]): Promise<(T & { created_by_name: string | null })[]> {
  if (!rows.some((r) => r.created_by)) return rows.map((r) => ({ ...r, created_by_name: null }));
  const { users } = await loadLookups();
  return rows.map((r) => ({ ...r, created_by_name: r.created_by ? users.get(r.created_by) ?? null : null }));
}
