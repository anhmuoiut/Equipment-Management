import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ appWrite: vi.fn(), selectAll: vi.fn(), selectOne: vi.fn(), from: vi.fn() }));
vi.mock('./core/db', () => ({ appWrite: m.appWrite, selectAll: m.selectAll, selectOne: m.selectOne, db: () => ({ from: m.from }) }));
vi.mock('./core/history', () => ({ readHistory: vi.fn(), withActorNames: async (rows: unknown[]) => rows }));
vi.mock('./core/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/lookups')>()),
  loadLookups: async () => (await import('./testing/fixtures')).makeLookups(),
}));

import { configList } from '@/lib/configuration';
import { schemaFor } from '@/app/api/configuration/schema';
import { createConfig, deleteConfig, listConfig, updateConfig } from './configuration';

const audit = { created_at: '2026-10-01T00:00:00Z', created_by: 'u1', updated_at: '2026-10-01T00:00:00Z', updated_by: null };
const list = (key: string) => configList(key)!;

beforeEach(() => {
  vi.resetAllMocks();
  m.appWrite.mockResolvedValue({ id: 'x' });
});

describe('listConfig', () => {
  it('Types carry their kind and their Group: the system Types (tester / base / fixture) and the sub-equipment Types the Admin added', async () => {
    m.selectAll.mockResolvedValue([
      { id: 'type-0', display_name: 'Tester', kind: 'tester', group_id: 'group-0', sort_order: 0, is_active: true, ...audit },
      { id: 'type-3', display_name: 'DMM', kind: 'sub_equipment', group_id: 'group-3', sort_order: 3, is_active: true, ...audit },
    ]);
    const rows = await listConfig(list('types'));
    expect(rows.map((r) => [r.display_name, r.kind, r.group_id, r.group])).toEqual([
      ['Tester', 'tester', 'group-0', 'Tester'], ['DMM', 'sub_equipment', 'group-3', 'Sub-equipment'],
    ]);
    // Mô tả nay thuộc Part Number, không còn ở Type.
    expect(rows[0]).not.toHaveProperty('description');
  });

  it('Groups are a plain list with their kind, so the system Groups can be told apart', async () => {
    m.selectAll.mockResolvedValue([
      { id: 'group-0', display_name: 'Tester', kind: 'tester', sort_order: 0, is_active: true, ...audit },
      { id: 'group-3', display_name: 'Sub-equipment', kind: 'sub_equipment', sort_order: 3, is_active: true, ...audit },
    ]);
    expect((await listConfig(list('type-groups'))).map((r) => [r.display_name, r.kind])).toEqual([['Tester', 'tester'], ['Sub-equipment', 'sub_equipment']]);
  });

  it('Part numbers show their Type and nothing about "needs a parent" any more', async () => {
    m.selectAll.mockResolvedValue([{ id: 'pn-0', display_name: 'P12316', type_id: 'type-0', sort_order: 0, is_active: true, ...audit }]);
    const [row] = await listConfig(list('part-numbers'));
    expect(row).toMatchObject({ display_name: 'P12316', type_id: 'type-0', type: 'Tester', level_id: null, level: null });
    expect(row).not.toHaveProperty('usage_needs_parent');
  });

  it('a part number with a Level shows its name', async () => {
    m.selectAll.mockResolvedValue([{ id: 'pn-1', display_name: 'P20001', type_id: 'type-1', level_id: 'level-2', sort_order: 1, is_active: true, ...audit }]);
    expect((await listConfig(list('part-numbers')))[0]).toMatchObject({ level_id: 'level-2', level: '3' });
  });

  it('a part number carries its Description (empty when none was entered)', async () => {
    m.selectAll.mockResolvedValue([
      { id: 'pn-0', display_name: 'P12316', type_id: 'type-0', description: 'Unified FT tester', sort_order: 0, is_active: true, ...audit },
      { id: 'pn-1', display_name: 'P20001', type_id: 'type-1', sort_order: 1, is_active: true, ...audit },
    ]);
    expect((await listConfig(list('part-numbers'))).map((r) => r.description)).toEqual(['Unified FT tester', null]);
  });

  it('a calibration Setup is named after its part number', async () => {
    m.selectAll.mockResolvedValue([{ id: 'cc1', part_number_id: 'pn-4', interval_months: 12, warning_days: 30, ...audit }]);
    expect((await listConfig(list('calibration-setup')))[0]).toMatchObject({ display_name: 'DMM-100', interval_months: 12, warning_days: 30 });
  });
});

describe('writes', () => {
  it.each(['yellow', 'red', 'purple'] as const)('accepts %s in the tag create and edit APIs', async (color) => {
    m.appWrite.mockResolvedValue({ id: 'tg1' });
    m.selectOne.mockResolvedValue({ id: 'tg1', display_name: 'Custom tag', sort_order: 0, color, ...audit });
    const payload = schemaFor(list('tags'), 'create').parse({ display_name: 'Custom tag', sort_order: 0, color });
    expect((await createConfig(list('tags'), payload, 'u1')).color).toBe(color);
    expect(m.appWrite).toHaveBeenCalledWith('tags', 'insert', null, payload, 'u1');
    const update = schemaFor(list('tags'), 'update').parse({ color });
    await updateConfig(list('tags'), 'tg1', update, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('tags', 'update', 'tg1', { color }, 'u1');
  });

  it('a new Setup needs a part number that exists and is still in use; the sub-equipment kind is checked by the database', async () => {
    await expect(createConfig(list('calibration-setup'), { interval_months: 12 }, 'u1')).rejects.toMatchObject({ details: { fields: { part_number_id: 'required' } } });
    m.selectOne.mockResolvedValue(null);
    await expect(createConfig(list('calibration-setup'), { part_number_id: 'x', interval_months: 12 }, 'u1')).rejects.toMatchObject({ details: { fields: { part_number_id: 'not_found' } } });
    m.selectOne.mockResolvedValue({ is_active: false });
    await expect(createConfig(list('calibration-setup'), { part_number_id: 'pn-5', interval_months: 12 }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });

  it('a part number can only be given a Type that is still in use; keeping a hidden one is fine', async () => {
    m.selectOne.mockResolvedValue({ id: 'pn-0', type_id: 'type-0' });
    await expect(createConfig(list('part-numbers'), { display_name: 'X', type_id: 'nope' }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await updateConfig(list('part-numbers'), 'pn-0', { type_id: 'type-0' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('part_numbers', 'update', 'pn-0', { type_id: 'type-0' }, 'u1');
  });

  it('the Level of a part number is optional, must be in use when chosen, and can be kept when hidden or cleared', async () => {
    m.selectOne.mockResolvedValue({ id: 'pn-0', type_id: 'type-0', level_id: 'level-1' });
    await createConfig(list('part-numbers'), { display_name: 'X', type_id: 'type-0' }, 'u1');
    await createConfig(list('part-numbers'), { display_name: 'Y', type_id: 'type-0', level_id: 'level-0' }, 'u1');
    await expect(createConfig(list('part-numbers'), { display_name: 'Z', type_id: 'type-0', level_id: 'nope' }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: { level_id: 'not_found' } } });
    await updateConfig(list('part-numbers'), 'pn-0', { level_id: 'level-1' }, 'u1'); // unchanged
    await updateConfig(list('part-numbers'), 'pn-0', { level_id: null }, 'u1'); // cleared
    await expect(updateConfig(list('part-numbers'), 'pn-0', { level_id: 'nope' }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.appWrite).toHaveBeenCalledTimes(4);
    expect(m.appWrite).toHaveBeenLastCalledWith('part_numbers', 'update', 'pn-0', { level_id: null }, 'u1');
  });

  it('a new Type needs a Group: it must exist, be in use and be a sub-equipment Group (the system Groups hold the system Types only)', async () => {
    await expect(createConfig(list('types'), { display_name: 'Scope' }, 'u1')).rejects.toMatchObject({ details: { fields: { group_id: 'required' } } });
    await expect(createConfig(list('types'), { display_name: 'Scope', group_id: 'nope' }, 'u1')).rejects.toMatchObject({ details: { fields: { group_id: 'not_found' } } });
    await expect(createConfig(list('types'), { display_name: 'Scope', group_id: 'group-0' }, 'u1')).rejects.toMatchObject({ details: { fields: { group_id: 'invalid' } } });
    expect(m.appWrite).not.toHaveBeenCalled();
    m.selectOne.mockResolvedValue({ id: 'x', kind: 'sub_equipment', group_id: 'group-3' });
    await createConfig(list('types'), { display_name: 'Scope', group_id: 'group-3' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('types', 'insert', null, { display_name: 'Scope', group_id: 'group-3' }, 'u1');
  });

  it('changing the Group of a Type: the new Group must be in use; keeping a hidden one is fine', async () => {
    m.selectOne.mockResolvedValue({ id: 'type-3', kind: 'sub_equipment', group_id: 'group-3' });
    await updateConfig(list('types'), 'type-3', { group_id: 'group-3' }, 'u1');
    await expect(updateConfig(list('types'), 'type-3', { group_id: 'nope' }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.appWrite).toHaveBeenCalledTimes(1);
  });

  it('Groups are added, renamed and hidden like any list — never sent a kind (the database makes them sub-equipment Groups)', async () => {
    m.selectOne.mockResolvedValue({ id: 'x', display_name: 'Meters', kind: 'sub_equipment', sort_order: 5, is_active: true, ...audit });
    await createConfig(list('type-groups'), { display_name: 'Meters', sort_order: 5 }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('type_groups', 'insert', null, { display_name: 'Meters', sort_order: 5 }, 'u1');
    await expect(deleteConfig(list('type-groups'), 'group-3', 'u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('only tags and Setup rows can be deleted for real; everything else is hidden instead', async () => {
    await expect(deleteConfig(list('locations'), 'l1', 'u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteConfig(list('types'), 't1', 'u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await deleteConfig(list('tags'), 'tg1', 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('tags', 'delete', 'tg1', null, 'u1');
  });
});
