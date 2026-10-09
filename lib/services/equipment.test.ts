import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no database in unit tests'); } }));

/**
 * Service Equipment với database giả trong bộ nhớ. Thao tác cây (Move, Detach, Đổi vị trí) là hàm database nên chỉ kiểm tra
 * service gọi đúng, đúng thứ tự, và chạy thử (dry run) trước khi ghi bất cứ thứ gì.
 *
 *   TESTER (B3F1, Level 1) ─ BASE ─ FIXTURE            LOOSE (B3F2, không cha)
 */
const rows = [
  { id: 'tester', serial_number: 'TESTER', parent_id: null, location_id: 'loc-0', level_id: 'level-0', part_number_id: 'pn-0', type_id: 'type-0' },
  { id: 'base', serial_number: 'BASE', parent_id: 'tester', location_id: 'loc-0', level_id: 'level-0', part_number_id: 'pn-3', type_id: 'type-2' },
  { id: 'fixture', serial_number: 'FIXTURE', parent_id: 'base', location_id: 'loc-0', level_id: 'level-0', part_number_id: 'pn-1', type_id: 'type-1' },
  { id: 'loose', serial_number: 'LOOSE', parent_id: null, location_id: 'loc-1', level_id: null, part_number_id: 'pn-1', type_id: 'type-1' },
].map((r) => ({
  jabil_id: null, asset: null, usage: 'not_in_use', remark: null, tag_ids: [] as string[],
  created_at: '2026-10-01T00:00:00Z', created_by: null, updated_at: '2026-10-01T00:00:00Z', updated_by: null, ...r,
}));

const db = vi.hoisted(() => ({ appWrite: vi.fn(), selectAll: vi.fn(), selectOne: vi.fn(), selectIn: vi.fn(), rpc: vi.fn() }));
vi.mock('./core/db', () => db);
const assets = vi.hoisted(() => ({
  assetOps: { move: vi.fn(), detach: vi.fn() }, changeAssetLocation: vi.fn(), equipmentWithLeafChildren: vi.fn(),
  assetLog: vi.fn(),
}));
vi.mock('./core/assets', () => assets);
vi.mock('./core/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/lookups')>()),
  loadLookups: async () => (await import('./testing/fixtures')).makeLookups(),
}));

import { AppError } from '@/lib/errors';
import { createEquipment, equipmentHistory, equipmentTree, getEquipment, listEquipment, updateEquipment } from './equipment';

beforeEach(() => {
  vi.resetAllMocks();
  db.selectOne.mockImplementation(selectOneWithEmbeds(rows));
  db.selectAll.mockImplementation(async () => rows);
  db.appWrite.mockResolvedValue({ id: 'loose' }); // dòng vừa tạo — getEquipment đọc lại nó
  leafChildren = {};
  assets.equipmentWithLeafChildren.mockResolvedValue(new Set());
  assets.assetOps.move.mockResolvedValue({});
  assets.assetOps.detach.mockResolvedValue({});
  assets.changeAssetLocation.mockResolvedValue({});
});

/** Các lệnh ghi theo thứ tự: tên + tham số chính (dry run ghi rõ). */
const calls = () => [
  ...db.appWrite.mock.calls.map((c, i) => ({ order: db.appWrite.mock.invocationCallOrder[i]!, call: ['app_write', c[3]] })),
  ...assets.assetOps.move.mock.calls.map((c, i) => ({ order: assets.assetOps.move.mock.invocationCallOrder[i]!, call: [c[4] ? 'move?' : 'move', c[1], c[2]] })),
  ...assets.assetOps.detach.mock.calls.map((c, i) => ({ order: assets.assetOps.detach.mock.invocationCallOrder[i]!, call: [c[3] ? 'detach?' : 'detach', c[1]] })),
  ...assets.changeAssetLocation.mock.calls.map((c, i) => ({ order: assets.changeAssetLocation.mock.invocationCallOrder[i]!, call: [c[4] ? 'location?' : 'location', c[1], c[2]] })),
].sort((a, b) => a.order - b.order).map((w) => w.call);

/**
 * PostgREST embed: each `parent:parent_id(...)` in the columns brings one more level of parents in the SAME query
 * (the row itself + one parent per embed), so a chain deeper than that is cut off.
 */
/** sub-equipment / golden boards hanging under an equipment (the "leaf" tables), per test. */
let leafChildren: Record<string, { subs?: number; golds?: number }> = {};

function selectOneWithEmbeds<T extends { id: string; parent_id: string | null }>(list: T[]) {
  const withParents = (row: T, levels: number): Record<string, unknown> => ({
    ...row, parent: row.parent_id && levels > 0 ? withParents(list.find((r) => r.id === row.parent_id)!, levels - 1) : null,
    // child counts (`relation(count)` embeds): equipment children from the list, the leaf tables from the test
    kids: [{ count: list.filter((r) => r.parent_id === row.id).length }],
    subs: [{ count: leafChildren[row.id]?.subs ?? 0 }],
    golds: [{ count: leafChildren[row.id]?.golds ?? 0 }],
  });
  return async (_table: string, id: string, columns?: string) => {
    const row = list.find((r) => r.id === id);
    if (!row) return null;
    const embeds = (columns?.match(/parent:parent_id/g) ?? []).length;
    return embeds ? withParents(row, embeds) : row;
  };
}

describe('rows', () => {
  it('shows the kind of the Type, the parent serial, the child flag, and sorts tags by their configured order', async () => {
    const list = await listEquipment();
    const byId = Object.fromEntries(list.map((r) => [r.id, r]));
    expect(byId.tester).toMatchObject({ kind: 'tester', part_number: 'P12316', type: 'Tester', location: 'B3F1', level: '1', has_children: true, parent_serial: null });
    expect(byId.fixture).toMatchObject({ kind: 'fixture', parent_serial: 'BASE', has_children: false });
    expect(byId.base).toMatchObject({ kind: 'base', has_children: true });
    expect(byId.loose).toMatchObject({ has_children: false });
    // The flag comes from the list itself (equipment children) + the leaf tables — the equipment table is read ONCE.
    expect(db.selectAll.mock.calls.filter((c) => c[0] === 'equipment')).toHaveLength(1);
  });

  it('a device whose only children are sub-equipment or golden boards still has the child flag', async () => {
    assets.equipmentWithLeafChildren.mockResolvedValue(new Set(['loose']));
    expect((await listEquipment()).find((r) => r.id === 'loose')).toMatchObject({ has_children: true });
  });

  it('a single row counts its children across the three tables — in the same query as the row', async () => {
    expect(await getEquipment('tester')).toMatchObject({ has_children: true }); // an equipment child
    expect(await getEquipment('fixture')).toMatchObject({ has_children: false, parent_serial: 'BASE' });
    leafChildren = { fixture: { subs: 1 } };
    expect(await getEquipment('fixture')).toMatchObject({ has_children: true }); // only a sub-equipment
    leafChildren = { fixture: { golds: 2 } };
    expect(await getEquipment('fixture')).toMatchObject({ has_children: true }); // only golden boards
    leafChildren = {};
    expect(db.selectOne).toHaveBeenLastCalledWith('equipment', 'fixture', expect.stringContaining('kids:equipment!parent_id(count)'));
    expect(db.selectOne).toHaveBeenLastCalledWith('equipment', 'fixture', expect.stringContaining('parent:parent_id(serial_number)')); // parent in the same query
    await expect(getEquipment('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a row shows its tags in the configured order, with colours', async () => {
    db.selectOne.mockResolvedValue({ ...rows[0], tag_ids: ['tg2', 'tg1', 'gone'] });
    expect((await getEquipment('tester')).tags).toEqual([
      { id: 'tg1', display_name: 'Repair', color: 'yellow' }, { id: 'tg2', display_name: 'Spare', color: 'gray' },
    ]);
  });
});

describe('createEquipment', () => {
  it('writes the form fields — never a Type (the database takes it from the part number)', async () => {
    await createEquipment({ serial_number: 'SN-1', part_number_id: 'pn-0', location_id: 'loc-1', level_id: 'level-1', tag_ids: ['tg1'], remark: 'x' }, 'u1');
    expect(db.appWrite).toHaveBeenCalledWith('equipment', 'insert', null,
      { serial_number: 'SN-1', part_number_id: 'pn-0', location_id: 'loc-1', level_id: 'level-1', tag_ids: ['tg1'], remark: 'x' }, 'u1');
  });

  it('needs a serial, a part number, and a location and Level unless a parent is given — nothing is written without them', async () => {
    await expect(createEquipment({ part_number_id: 'pn-0', location_id: 'loc-0', level_id: 'level-0' }, 'u1')).rejects.toMatchObject({ details: { fields: { serial_number: 'required' } } });
    await expect(createEquipment({ serial_number: 'S', location_id: 'loc-0', level_id: 'level-0' }, 'u1')).rejects.toMatchObject({ details: { fields: { part_number_id: 'required' } } });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-0', level_id: 'level-0' }, 'u1')).rejects.toMatchObject({ details: { fields: { location_id: 'required' } } });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-0', location_id: 'loc-0' }, 'u1')).rejects.toMatchObject({ details: { fields: { level_id: 'required' } } });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-0', location_id: 'loc-0', level_id: null }, 'u1')).rejects.toMatchObject({ details: { fields: { level_id: 'required' } } });
    expect(db.appWrite).not.toHaveBeenCalled();
  });

  it('Type, Level and Location are all filled for every device: Type from the part number, Level and Location from the form (a child takes both from its parent)', async () => {
    await createEquipment({ serial_number: 'OK', part_number_id: 'pn-0', location_id: 'loc-1', level_id: 'level-2' }, 'u1');
    expect(db.appWrite).toHaveBeenCalledWith('equipment', 'insert', null, expect.objectContaining({ location_id: 'loc-1', level_id: 'level-2' }), 'u1');
    expect(db.appWrite.mock.calls[0]![3]).not.toHaveProperty('type_id');
  });

  it('a child copies the location and Level of its parent; a sent location or Level is ignored', async () => {
    await createEquipment({ serial_number: 'FX', part_number_id: 'pn-1', parent_id: 'tester', location_id: 'loc-1', level_id: 'level-3' }, 'u1');
    expect(db.appWrite).toHaveBeenCalledWith('equipment', 'insert', null,
      { serial_number: 'FX', part_number_id: 'pn-1', parent_id: 'tester', location_id: 'loc-0', level_id: 'level-0' }, 'u1');
  });

  it('refuses a missing parent, hidden values and unknown tags — nothing written', async () => {
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-1', parent_id: 'gone' }, 'u1')).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-2', location_id: 'loc-0', level_id: 'level-0' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-0', location_id: 'loc-2', level_id: 'level-0' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    await expect(createEquipment({ serial_number: 'S', part_number_id: 'pn-0', location_id: 'loc-0', level_id: 'level-0', tag_ids: ['nope'] }, 'u1'))
      .rejects.toMatchObject({ details: { fields: { tag_ids: 'not_found' } } });
    expect(db.appWrite).not.toHaveBeenCalled();
  });
});

describe('updateEquipment — cha và vị trí sửa được trong form (Move / Detach / Đổi vị trí của database)', () => {
  it('the Level of a device without a parent cannot be cleared; a device with a parent follows it (a sent value is ignored)', async () => {
    await expect(updateEquipment('loose', { level_id: null }, 'u1')).rejects.toMatchObject({ details: { fields: { level_id: 'required' } } });
    expect(db.appWrite).not.toHaveBeenCalled();
    await updateEquipment('fixture', { level_id: null, jabil_id: 'J' }, 'u1');
    expect(calls()).toEqual([['app_write', { jabil_id: 'J' }]]);
  });

  it('a new parent moves the equipment: dry run first, then the fields, then the real Move (a sent location is ignored)', async () => {
    await updateEquipment('loose', { parent_id: 'base', location_id: 'loc-0', jabil_id: 'J9' }, 'u1');
    expect(calls()).toEqual([['move?', 'loose', 'base'], ['app_write', { jabil_id: 'J9' }], ['move', 'loose', 'base']]);
  });

  it('clearing the parent detaches, then applies the new location', async () => {
    await updateEquipment('fixture', { parent_id: null, location_id: 'loc-1', jabil_id: 'J9' }, 'u1');
    expect(calls()).toEqual([
      ['detach?', 'fixture'], ['app_write', { jabil_id: 'J9' }], ['detach', 'fixture'], ['location', 'fixture', 'loc-1'],
    ]);
  });

  it('an unchanged parent writes only the other fields', async () => {
    await updateEquipment('fixture', { parent_id: 'base', jabil_id: 'J9' }, 'u1');
    expect(calls()).toEqual([['app_write', { jabil_id: 'J9' }]]);
  });

  it('writes nothing when the database refuses the Move in the dry run', async () => {
    assets.assetOps.move.mockRejectedValueOnce(new AppError('PARENT_TYPE_INVALID'));
    await expect(updateEquipment('loose', { parent_id: 'base', jabil_id: 'J9' }, 'u1')).rejects.toMatchObject({ code: 'PARENT_TYPE_INVALID' });
    expect(db.appWrite).not.toHaveBeenCalled();
    expect(assets.assetOps.move).toHaveBeenCalledTimes(1);
  });

  it('a loose equipment changes its own location: dry run, the fields, then Đổi vị trí', async () => {
    await updateEquipment('loose', { location_id: 'loc-0', jabil_id: 'J9' }, 'u1');
    expect(calls()).toEqual([['location?', 'loose', 'loc-0'], ['app_write', { jabil_id: 'J9' }], ['location', 'loose', 'loc-0']]);
    db.appWrite.mockClear();
    assets.changeAssetLocation.mockRejectedValueOnce(new AppError('EQUIPMENT_IN_USE'));
    await expect(updateEquipment('loose', { location_id: 'loc-0', jabil_id: 'J9' }, 'u1')).rejects.toMatchObject({ code: 'EQUIPMENT_IN_USE' });
    expect(db.appWrite).not.toHaveBeenCalled();
  });

  it('a child keeping its parent cannot change location on its own', async () => {
    await expect(updateEquipment('fixture', { location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ code: 'LOCATION_INHERITED_READ_ONLY' });
    expect(calls()).toEqual([]);
  });

  it('is NOT_FOUND for an unknown equipment', async () => {
    await expect(updateEquipment('nope', { jabil_id: 'J' }, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Part number, Type and Level', () => {
  it('a part number change is written as is — the database keeps the Type (and refuses another Type)', async () => {
    await updateEquipment('loose', { part_number_id: 'pn-1' }, 'u1');
    expect(db.appWrite).toHaveBeenCalledWith('equipment', 'update', 'loose', { part_number_id: 'pn-1' }, 'u1');
  });

  it('a hidden part number cannot be newly chosen, but an equipment may keep the one it already has', async () => {
    await expect(updateEquipment('loose', { part_number_id: 'pn-2' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    db.selectOne.mockResolvedValue({ ...rows[3], part_number_id: 'pn-2' });
    await updateEquipment('loose', { part_number_id: 'pn-2', jabil_id: 'J' }, 'u1');
    expect(db.appWrite).toHaveBeenCalledTimes(1);
  });

  it('a child ignores a Level sent on its own (it follows the parent)', async () => {
    await updateEquipment('fixture', { level_id: 'level-3', jabil_id: 'J' }, 'u1');
    expect(calls()).toEqual([['app_write', { jabil_id: 'J' }]]);
  });

  it('equipment without a parent changes its Level (the database carries it down the tree)', async () => {
    await updateEquipment('loose', { level_id: 'level-3' }, 'u1');
    expect(calls()).toEqual([['app_write', { level_id: 'level-3' }]]);
  });

  it('a new parent: Level follows that parent, a sent Level is ignored', async () => {
    await updateEquipment('loose', { parent_id: 'base', level_id: 'level-3' }, 'u1');
    expect(calls()).toEqual([['move?', 'loose', 'base'], ['move', 'loose', 'base']]);
  });

  it('detaching and picking a Level: detach first, then write the Level', async () => {
    await updateEquipment('fixture', { parent_id: null, level_id: 'level-3' }, 'u1');
    expect(calls()).toEqual([['detach?', 'fixture'], ['detach', 'fixture'], ['app_write', { level_id: 'level-3' }]]);
  });
});

describe('Tags', () => {
  it('known tags are saved as an array of ids, in the order picked; clearing every tag is allowed', async () => {
    await updateEquipment('loose', { tag_ids: ['tg2', 'tg1'] }, 'u1');
    await updateEquipment('loose', { tag_ids: [] }, 'u1');
    expect(db.appWrite.mock.calls.map((c) => c[3])).toEqual([{ tag_ids: ['tg2', 'tg1'] }, { tag_ids: [] }]);
  });

  it('an unknown tag id is refused on the tags field, nothing written', async () => {
    await expect(updateEquipment('loose', { tag_ids: ['tg1', 'gone'] }, 'u1')).rejects.toMatchObject({ details: { fields: { tag_ids: 'not_found' } } });
    expect(db.appWrite).not.toHaveBeenCalled();
  });
});

describe('equipmentTree — cây từ tài sản gốc, cả sub-equipment và golden board', () => {
  const row = (over: Record<string, unknown>) => ({
    asset_type: 'equipment', id: 'x', kind: 'fixture', type_name: 'Fixture', part_number: 'P20001', serial_number: 'X', usage: 'not_in_use',
    cal_status: null, parent_id: null, depth: 0, pos: 1, ...over,
  });

  it('is ONE call of asset_tree; nodes come in tree order with kind, Type, usage and the calibration status', async () => {
    db.rpc.mockResolvedValue([
      row({ id: 'gb', asset_type: 'golden_board', kind: 'golden_board', type_name: null, part_number: 'GB-1', serial_number: 'G-7', parent_id: 'fixture', depth: 3, pos: 4 }),
      row({ id: 'tester', kind: 'tester', type_name: 'Tester', part_number: 'P12316', serial_number: 'TESTER', usage: 'in_use', pos: 1 }),
      row({ id: 'base', kind: 'base', type_name: 'Base', part_number: 'B-100', serial_number: 'BASE', parent_id: 'tester', depth: 1, pos: 2 }),
      row({ id: 'fixture', serial_number: 'FIXTURE', parent_id: 'base', depth: 2, pos: 3 }),
      row({ id: 'dmm', asset_type: 'sub_equipment', kind: 'sub_equipment', type_name: 'DMM', part_number: 'DMM-100', serial_number: 'DMM-7', parent_id: 'tester', depth: 1, cal_status: 'overdue', pos: 5 }),
    ]);
    const tree = await equipmentTree('fixture'); // asked from the Fixture — the database walks up to the Tester
    expect(db.rpc.mock.calls).toEqual([['asset_tree', { p_type: 'equipment', p_id: 'fixture' }]]);
    expect(db.selectOne).not.toHaveBeenCalled();
    expect(tree.root_id).toBe('tester');
    expect(tree.nodes.map((n) => [n.asset_type, n.kind, n.serial_number, n.parent_id, n.part_number])).toEqual([
      ['equipment', 'tester', 'TESTER', null, 'P12316'], ['equipment', 'base', 'BASE', 'tester', 'B-100'], ['equipment', 'fixture', 'FIXTURE', 'base', 'P20001'],
      ['golden_board', 'golden_board', 'G-7', 'fixture', 'GB-1'], ['sub_equipment', 'sub_equipment', 'DMM-7', 'tester', 'DMM-100'],
    ]);
    expect(tree.nodes[0]).toMatchObject({ type_name: 'Tester', usage: 'in_use', cal_status: null });
    expect(tree.nodes[4]).toMatchObject({ type_name: 'DMM', cal_status: 'overdue' });
    expect(tree.nodes[3]).toMatchObject({ type_name: null });
  });

  it('an equipment that does not exist (no rows) is NOT_FOUND', async () => {
    db.rpc.mockResolvedValue([]);
    await expect(equipmentTree('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    db.rpc.mockResolvedValue(null);
    await expect(equipmentTree('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('history comes from asset_logs', async () => {
    assets.assetLog.mockResolvedValue([]);
    await equipmentHistory('tester');
    expect(assets.assetLog).toHaveBeenCalledWith('equipment', 'tester');
  });
});
