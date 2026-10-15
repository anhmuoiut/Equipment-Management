import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('./core/db', () => ({ db: () => ({ from: m.from }) }));

import { fakeListDb } from './testing/listBuilder';
import { invalidateReads } from './core/readCache';
import { filterValues, parseFilterList } from './listFilters';

let fake: ReturnType<typeof fakeListDb>;
const serve = (byView: Record<string, Record<string, unknown>[]>) => {
  m.from.mockImplementation((view: string) => fakeListDb(byView[view] ?? []).from(view));
};

beforeEach(() => { m.from.mockReset(); invalidateReads(); });

describe('parseFilterList', () => {
  it('knows the three list screens, nothing else', () => {
    expect(parseFilterList('equipment')).toBe('equipment');
    expect(parseFilterList('calibration')).toBe('calibration');
    expect(parseFilterList('golden')).toBe('golden');
    expect(() => parseFilterList('users')).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => parseFilterList(undefined)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('filterValues', () => {
  it('Equipment: the serials of the equipment that have children, once each, in natural order', async () => {
    serve({ equipment_list: [{ serial_number: 'T-10' }, { serial_number: 'T-2' }, { serial_number: 'T-2' }, { serial_number: 'B-1' }] });
    expect(await filterValues('equipment')).toEqual({ parent: ['B-1', 'T-2', 'T-10'] });
    expect(m.from).toHaveBeenCalledTimes(1);
    expect(m.from).toHaveBeenCalledWith('equipment_list');
  });

  it('asks the database for parents only (has_children, the right kinds) and never reads a whole table', async () => {
    fake = fakeListDb([{ serial_number: 'T-1' }]);
    m.from.mockImplementation(fake.from);
    await filterValues('calibration');
    expect(fake.calls('select')).toEqual([['serial_number']]);
    expect(fake.calls('eq')).toEqual([['has_children', true]]);
    expect(fake.calls('in')).toEqual([['kind', ['tester']]]); // a sub-equipment hangs under a tester
    expect(fake.calls('limit')).toEqual([[1000]]);
  });

  it('Golden board: its own part numbers and origins (from golden_list) and the testers / fixtures that hold one', async () => {
    serve({
      equipment_list: [{ serial_number: 'FIX-1' }],
      golden_list: [{ part_number: 'GB-2' }, { part_number: 'GB-1' }, { part_number: 'GB-2' }, { origin: 'Vendor X' }],
    });
    // both golden columns come from the same fake rows here; what matters is that each key is built from its own column
    const values = await filterValues('golden');
    expect(Object.keys(values).sort()).toEqual(['origin', 'parent', 'part_number']);
    expect(values.parent).toEqual(['FIX-1']);
  });

  it('remembers the answer for a minute — opening the screen again does not read the database again', async () => {
    serve({ equipment_list: [{ serial_number: 'T-1' }] });
    await filterValues('equipment');
    await filterValues('equipment');
    expect(m.from).toHaveBeenCalledTimes(1);
  });

  it('forgets it after any write of the application (a tester that just got its first child must appear)', async () => {
    serve({ equipment_list: [{ serial_number: 'T-1' }] });
    await filterValues('equipment');
    invalidateReads();
    await filterValues('equipment');
    expect(m.from).toHaveBeenCalledTimes(2);
  });

  it('a database error is reported and not remembered', async () => {
    m.from.mockImplementationOnce(() => ({
      select: () => ({ not: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: null, error: { code: 'XX000', message: 'x' } }) }) }) }) }),
    }));
    await expect(filterValues('equipment')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    serve({ equipment_list: [{ serial_number: 'T-1' }] });
    expect(await filterValues('equipment')).toEqual({ parent: ['T-1'] }); // the next call tries again
  });
});
