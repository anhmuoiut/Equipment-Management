import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ appWrite: vi.fn(), selectAll: vi.fn(), selectIn: vi.fn(), selectOne: vi.fn() }));
vi.mock('./core/db', () => m);
const assets = vi.hoisted(() => ({ applyTreeEdit: vi.fn(), previewTreeEdit: vi.fn(), assetLog: vi.fn() }));
vi.mock('./core/assets', () => assets);
vi.mock('./core/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/lookups')>()),
  loadLookups: async () => (await import('./testing/fixtures')).makeLookups(),
}));

import { AppError } from '@/lib/errors';
import { createGolden, getGolden, goldenHistory, listGolden, updateGolden } from './golden';

const golden = (over: Record<string, unknown> = {}) => ({
  id: 'g1', part_number: 'GB-1', serial_number: 'G-7', utd_part_number: null, origin: null, purpose: null, parent_id: 'fixture',
  parent: { serial_number: 'FIXTURE-01' } as { serial_number: string } | null, location_id: 'loc-0', usage: 'not_in_use', remark: null, tag_ids: ['tg1'], created_at: '2026-10-01T00:00:00Z', created_by: 'u1',
  updated_at: '2026-10-01T00:00:00Z', updated_by: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.selectOne.mockImplementation(async () => golden());
  m.appWrite.mockResolvedValue({ id: 'g1' });
});

describe('rows', () => {
  it('lists golden boards with the serial of their tester / fixture, Status and tags', async () => {
    m.selectAll.mockResolvedValue([golden(), golden({ id: 'g2', parent_id: null, parent: null, location_id: 'loc-1', usage: 'in_use' })]);
    const rows = await listGolden();
    // The parent's serial comes in the same query (embedded) — no second round trip to read the parents.
    expect(m.selectAll).toHaveBeenCalledWith('golden_boards', expect.stringContaining('parent:parent_id(serial_number)'));
    expect(m.selectIn).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ serial_number: 'G-7', parent_serial: 'FIXTURE-01', location: 'B3F1', usage: 'not_in_use', tags: [{ display_name: 'Repair' }] });
    expect(rows[1]).toMatchObject({ parent_id: null, parent_serial: null, location: 'B3F2', usage: 'in_use' });
  });

  it('a single row reads its parent; unknown id is NOT_FOUND', async () => {
    expect(await getGolden('g1')).toMatchObject({ parent_serial: 'FIXTURE-01' });
    expect(m.selectOne).toHaveBeenCalledTimes(1); // one query for the row AND its parent
    expect(m.selectOne).toHaveBeenCalledWith('golden_boards', 'g1', expect.stringContaining('parent:parent_id(serial_number)'));
    m.selectOne.mockResolvedValue(null);
    await expect(getGolden('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('createGolden', () => {
  it('attached to a tester / fixture it is saved without a location (the database takes the parent\'s)', async () => {
    await createGolden({ part_number: 'GB-1', serial_number: 'G-7', parent_id: 'fixture', location_id: 'loc-1' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('golden_boards', 'insert', null, { part_number: 'GB-1', serial_number: 'G-7', parent_id: 'fixture' }, 'u1');
  });

  it('a loose one needs a location; part number and serial are required; tags must exist; hidden location refused', async () => {
    await createGolden({ part_number: 'GB-1', serial_number: 'G-7', location_id: 'loc-1' }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('golden_boards', 'insert', null, { part_number: 'GB-1', serial_number: 'G-7', location_id: 'loc-1' }, 'u1');
    m.appWrite.mockClear();
    await expect(createGolden({ serial_number: 'G', location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ details: { fields: { part_number: 'required' } } });
    await expect(createGolden({ part_number: 'P', location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ details: { fields: { serial_number: 'required' } } });
    await expect(createGolden({ part_number: 'P', serial_number: 'G' }, 'u1')).rejects.toMatchObject({ details: { fields: { location_id: 'required' } } });
    await expect(createGolden({ part_number: 'P', serial_number: 'G', location_id: 'loc-2' }, 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    await expect(createGolden({ part_number: 'P', serial_number: 'G', location_id: 'loc-1', tag_ids: ['x'] }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });
});

describe('updateGolden', () => {
  it('a new parent: dry run first, then the fields, then the real Move', async () => {
    await updateGolden('g1', { parent_id: 'tester', location_id: 'loc-1', remark: 'r' }, 'u1');
    expect(assets.previewTreeEdit).toHaveBeenCalledWith('golden_board', 'g1', { parentTo: 'tester', location: undefined }, 'u1');
    expect(m.appWrite).toHaveBeenCalledWith('golden_boards', 'update', 'g1', { remark: 'r' }, 'u1');
    expect(assets.applyTreeEdit).toHaveBeenCalledWith('golden_board', 'g1', { parentTo: 'tester', location: undefined }, 'u1');
  });

  it('detaching then picking a location; an unchanged parent writes only the fields', async () => {
    await updateGolden('g1', { parent_id: null, location_id: 'loc-1' }, 'u1');
    expect(assets.applyTreeEdit).toHaveBeenLastCalledWith('golden_board', 'g1', { parentTo: null, location: 'loc-1' }, 'u1');
    assets.applyTreeEdit.mockClear();
    m.appWrite.mockClear();
    await updateGolden('g1', { parent_id: 'fixture', remark: 'r' }, 'u1');
    expect(assets.applyTreeEdit).toHaveBeenCalledWith('golden_board', 'g1', { parentTo: undefined, location: undefined }, 'u1');
    expect(m.appWrite).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the dry run is refused; a child cannot change location on its own', async () => {
    assets.previewTreeEdit.mockRejectedValueOnce(new AppError('PARENT_TYPE_INVALID'));
    await expect(updateGolden('g1', { parent_id: 'base', remark: 'r' }, 'u1')).rejects.toMatchObject({ code: 'PARENT_TYPE_INVALID' });
    expect(m.appWrite).not.toHaveBeenCalled();
    await expect(updateGolden('g1', { location_id: 'loc-1' }, 'u1')).rejects.toMatchObject({ code: 'LOCATION_INHERITED_READ_ONLY' });
    m.selectOne.mockResolvedValue(null);
    await expect(updateGolden('nope', { remark: 'r' }, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('history comes from asset_logs', async () => {
    await goldenHistory('g1');
    expect(assets.assetLog).toHaveBeenCalledWith('golden_board', 'g1');
  });
});
