import 'server-only';

/**
 * Module Golden board — bảng golden_boards. docs/DATABASE_MODIFIED.md mục 5.
 * Gắn vào tester hoặc fixture (parent_id); có cha thì vị trí và Status theo cha (database). Nhật ký ghi vào asset_logs.
 * Xóa, Swap, Move, Detach, Đổi vị trí, Check-out / Check-in: route dùng chung /api/assets.
 */
import { appWrite, selectAll, selectOne } from './core/db';
import { applyTreeEdit, assetLog, previewTreeEdit } from './core/assets';
import { assertActive, assertTags, auditOf, loadLookups, nameOf, tagItems, type Lookups } from './core/lookups';
import { AppError } from '@/lib/errors';
import type { GoldenRow, HistoryEntry, Usage } from '@/lib/types';

type DbGolden = {
  id: string; part_number: string; serial_number: string; utd_part_number: string | null; origin: string | null;
  purpose: string | null; parent_id: string | null; location_id: string; usage: Usage; remark: string | null; tag_ids: string[];
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
};

/** `parent_id`: tester hoặc fixture chứa nó (null = chưa gắn). Đổi cha / vị trí khi sửa đi qua Move / Detach / Đổi vị trí. */
export type GoldenInput = {
  part_number?: string; serial_number?: string; utd_part_number?: string | null; origin?: string | null; purpose?: string | null;
  parent_id?: string | null; location_id?: string | null; remark?: string | null; tag_ids?: string[];
};

/** Cha (tester / fixture) kèm serial — PostgREST gửi cùng một truy vấn, không cần đọc cha riêng. */
const WITH_PARENT = '*, parent:parent_id(serial_number)';
type WithParent = DbGolden & { parent: { serial_number: string } | null };

function toRow(g: WithParent, lookups: Lookups): GoldenRow {
  return {
    id: g.id, part_number: g.part_number, serial_number: g.serial_number, utd_part_number: g.utd_part_number,
    origin: g.origin, purpose: g.purpose,
    parent_id: g.parent_id, parent_serial: g.parent?.serial_number ?? null,
    location_id: g.location_id, location: nameOf(lookups.locations, g.location_id),
    usage: g.usage, remark: g.remark,
    tag_ids: g.tag_ids ?? [], tags: tagItems(lookups, g.tag_ids),
    ...auditOf(lookups, g),
  };
}

export async function listGolden(): Promise<GoldenRow[]> {
  const [rows, lookups] = await Promise.all([selectAll<WithParent>('golden_boards', WITH_PARENT), loadLookups()]);
  return rows.map((r) => toRow(r, lookups));
}

export async function getGolden(id: string): Promise<GoldenRow> {
  const [row, lookups] = await Promise.all([selectOne<WithParent>('golden_boards', id, WITH_PARENT), loadLookups()]);
  if (!row) throw new AppError('NOT_FOUND');
  return toRow(row, lookups);
}

function validate(input: GoldenInput, lookups: Lookups, before?: DbGolden) {
  assertActive(lookups.locations, input.location_id, 'location_id', before?.location_id);
  assertTags(lookups, input.tag_ids);
}

/** Thêm golden board. Có cha thì vị trí và Status theo cha (database). Serial trùng chỉ cảnh báo (serial-matches). */
export async function createGolden(input: GoldenInput, actor: string): Promise<GoldenRow> {
  if (!input.part_number) throw new AppError('VALIDATION_ERROR', { fields: { part_number: 'required' } });
  if (!input.serial_number) throw new AppError('VALIDATION_ERROR', { fields: { serial_number: 'required' } });
  if (!input.parent_id && !input.location_id) throw new AppError('VALIDATION_ERROR', { fields: { location_id: 'required' } });
  const lookups = await loadLookups();
  validate({ ...input, location_id: input.parent_id ? undefined : input.location_id }, lookups);
  const { location_id, ...rest } = input;
  const created = await appWrite<DbGolden>('golden_boards', 'insert', null, input.parent_id ? rest : { ...rest, location_id }, actor);
  return getGolden(created.id);
}

/** Sửa thông tin; đổi cha → Move / Detach, đổi vị trí (chưa gắn cha) → Đổi vị trí. Chạy thử trước khi ghi. */
export async function updateGolden(id: string, input: GoldenInput, actor: string): Promise<GoldenRow> {
  const [before, lookups] = await Promise.all([selectOne<DbGolden>('golden_boards', id), loadLookups()]);
  if (!before) throw new AppError('NOT_FOUND');

  const { location_id, parent_id: parentInput, ...fields } = input;
  const parentChanged = parentInput !== undefined && parentInput !== before.parent_id;
  const parentAfter = parentInput !== undefined ? parentInput : before.parent_id;
  const locationChanged = location_id !== undefined && location_id !== before.location_id;
  if (locationChanged && parentAfter && !parentChanged) throw new AppError('LOCATION_INHERITED_READ_ONLY');
  const setLocation = locationChanged && !parentAfter;

  validate({ ...fields, location_id: setLocation ? location_id : undefined }, lookups, before);
  const edit = { parentTo: parentChanged ? parentInput : undefined, location: setLocation ? location_id! : undefined };
  await previewTreeEdit('golden_board', id, edit, actor);
  if (Object.keys(fields).length) await appWrite('golden_boards', 'update', id, fields, actor);
  await applyTreeEdit('golden_board', id, edit, actor);
  return getGolden(id);
}

export function goldenHistory(id: string): Promise<HistoryEntry[]> {
  return assetLog('golden_board', id);
}
