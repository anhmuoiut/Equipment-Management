import 'server-only';

/**
 * Dữ liệu gốc dùng chung (Configuration) + tên người dùng, để đổi id → chữ hiển thị cho danh sách và chi tiết.
 * Được nhớ trong tiến trình (lookupCache.ts): các Map trả về dùng chung cho mọi request — CHỈ ĐỌC, không sửa.
 */
import { selectAll } from './db';
import { cachedLookups } from './lookupCache';
import { AppError } from '@/lib/errors';
import type { OptionItem, Options, PartNumberOption, TagItem, TagOption, TypeGroupOption, TypeKind, TypeOption } from '@/lib/types';

type Named = { id: string; display_name: string; sort_order: number; is_active: boolean };
/** Part Number metadata shared by asset selectors and read-only detail fields. */
type PartNumber = Named & { type_id: string; level_id: string | null; manufacturer: string | null; description: string | null; remark: string | null };
/** `group_id`: nhóm của Type; `kind` luôn bằng kind của nhóm. */
type TypeRow = Named & { kind: TypeKind; group_id: string };
type TypeGroupRow = Named & { kind: TypeKind };

export type Lookups = {
  part_numbers: Map<string, PartNumber>;
  locations: Map<string, Named>;
  types: Map<string, TypeRow>;
  type_groups: Map<string, TypeGroupRow>;
  levels: Map<string, Named>;
  departments: Map<string, Named>;
  calibration_vendors: Map<string, Named>;
  tags: Map<string, TagOption>;
  users: Map<string, string>;
};

const byOrder = <T extends { sort_order: number; display_name: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, undefined, { numeric: true });

const toMap = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
const BASIC = 'id, display_name, sort_order, is_active';

export const loadLookups = (): Promise<Lookups> => cachedLookups(readLookups);

async function readLookups(): Promise<Lookups> {
  const [part_numbers, locations, types, type_groups, levels, departments, calibration_vendors, tags, users] = await Promise.all([
    selectAll<PartNumber>('part_numbers', `${BASIC}, type_id, level_id, manufacturer, description, remark`),
    selectAll<Named>('locations', BASIC),
    selectAll<TypeRow>('types', `${BASIC}, kind, group_id`),
    selectAll<TypeGroupRow>('type_groups', `${BASIC}, kind`),
    selectAll<Named>('levels', BASIC),
    selectAll<Named>('departments', BASIC),
    selectAll<Named>('calibration_vendors', BASIC),
    selectAll<TagOption>('tags', 'id, display_name, sort_order, color'),
    selectAll<{ id: string; full_name: string }>('user_profiles', 'id, full_name'),
  ]);
  return {
    part_numbers: toMap(part_numbers), locations: toMap(locations), types: toMap(types), type_groups: toMap(type_groups), levels: toMap(levels),
    departments: toMap(departments), calibration_vendors: toMap(calibration_vendors), tags: toMap(tags),
    users: new Map(users.map((u) => [u.id, u.full_name])),
  };
}

export function nameOf(map: Map<string, { display_name: string }>, id: string | null | undefined): string | null {
  return id ? map.get(id)?.display_name ?? null : null;
}

/** Thẻ đang gắn (tên + màu) theo thứ tự Configuration › Tag; id không còn tồn tại bị bỏ. */
export function tagItems(lookups: Lookups, ids: readonly string[] | null | undefined): TagItem[] {
  return (ids ?? [])
    .map((id) => lookups.tags.get(id))
    .filter((t): t is TagOption => !!t)
    .sort(byOrder)
    .map(({ id, display_name, color }) => ({ id, display_name, color }));
}

/** Thẻ gửi lên phải có thật (database cũng kiểm tra). */
export function assertTags(lookups: Lookups, ids: readonly string[] | undefined): void {
  if (ids?.some((id) => !lookups.tags.has(id))) throw new AppError('VALIDATION_ERROR', { fields: { tag_ids: 'not_found' } });
}

/** Loại (tester / base / fixture / sub_equipment) của một Type. */
export function kindOf(lookups: Lookups, typeId: string | null | undefined): TypeKind | null {
  return typeId ? lookups.types.get(typeId)?.kind ?? null : null;
}

/** Type của part number (Configuration › Part Number) — thiết bị mang part number đó luôn có Type này. */
export function partNumberType(lookups: Lookups, partNumberId: string | null | undefined): string | null {
  return partNumberId ? lookups.part_numbers.get(partNumberId)?.type_id ?? null : null;
}

export function userName(lookups: Lookups, id: string | null | undefined): string | null {
  return id ? lookups.users.get(id) ?? null : null;
}

/** created_* / updated_* kèm tên người. */
export function auditOf(lookups: Lookups, row: {
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
}) {
  return {
    created_at: row.created_at, created_by: row.created_by, created_by_name: userName(lookups, row.created_by),
    updated_at: row.updated_at, updated_by: row.updated_by, updated_by_name: userName(lookups, row.updated_by),
  };
}

export function toOptions(lookups: Lookups): Options {
  const list = (map: Map<string, Named>): OptionItem[] => [...map.values()].sort(byOrder);
  return {
    part_numbers: [...lookups.part_numbers.values()].sort(byOrder)
      .map((pn): PartNumberOption => ({ ...pn, kind: kindOf(lookups, pn.type_id) ?? 'sub_equipment' })),
    locations: list(lookups.locations),
    types: [...lookups.types.values()].sort(byOrder) satisfies TypeOption[],
    type_groups: [...lookups.type_groups.values()].sort(byOrder) satisfies TypeGroupOption[],
    levels: list(lookups.levels),
    departments: list(lookups.departments),
    calibration_vendors: list(lookups.calibration_vendors),
    tags: [...lookups.tags.values()].sort(byOrder),
  };
}

/**
 * Giá trị FK mới chọn phải còn đang dùng (is_active). Giữ nguyên giá trị cũ
 * đã ẩn thì được — chỉ chặn khi đổi sang một giá trị đã ẩn.
 */
export function assertActive(
  map: Map<string, Named>, id: string | null | undefined, field: string, previous?: string | null,
): void {
  if (!id || id === previous) return;
  const row = map.get(id);
  if (!row) throw new AppError('VALIDATION_ERROR', { fields: { [field]: 'not_found' } });
  if (!row.is_active) throw new AppError('INACTIVE_OPTION', { fields: { [field]: 'inactive' } });
}
