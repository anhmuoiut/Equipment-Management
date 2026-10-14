import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ selectAll: vi.fn(), selectIn: vi.fn(), from: vi.fn() }));
vi.mock('./core/db', () => ({ selectAll: m.selectAll, selectIn: m.selectIn, db: () => ({ from: m.from }) }));
vi.mock('./core/history', () => ({
  withActorNames: async (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, created_by_name: 'Ann' })),
}));
vi.mock('./core/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/lookups')>()),
  loadLookups: async () => (await import('./testing/fixtures')).makeLookups(),
}));

import { chain } from './testing/chain';
import { getDashboard, recentActivities } from './dashboard';

beforeEach(() => {
  vi.resetAllMocks();
  m.selectAll.mockImplementation(async (table: string) => ({
    equipment: [
      { id: 'e1', usage: 'in_use', location_id: 'loc-0', type_id: 'type-0', tag_ids: ['tg1'] },
      { id: 'e2', usage: 'not_in_use', location_id: 'loc-1', type_id: 'type-1', tag_ids: [] },
    ],
    sub_equipment: [
      { id: 's1', serial_number: 'DMM-1', part_number_id: 'pn-4', type_id: 'type-3', tester_id: 'e1', tester: { serial_number: 'TESTER-01' }, usage: 'in_use', location_id: 'loc-0', tag_ids: ['tg1', 'tg2'] },
      { id: 's2', serial_number: 'DMM-2', part_number_id: 'pn-4', type_id: 'type-3', tester_id: null, tester: null, usage: 'not_in_use', location_id: 'loc-1', tag_ids: [] },
      { id: 's3', serial_number: 'DMM-3', part_number_id: 'pn-4', type_id: 'type-3', tester_id: 'e1', tester: { serial_number: 'TESTER-01' }, usage: 'in_use', location_id: 'loc-0', tag_ids: [] },
      { id: 's4', serial_number: 'DMM-4', part_number_id: 'pn-4', type_id: 'type-3', tester_id: null, tester: null, usage: 'not_in_use', location_id: 'loc-1', tag_ids: [] },
    ],
    golden_boards: [{ id: 'g1', usage: 'in_use', location_id: 'loc-0', tag_ids: ['tg2'] }],
    // s4 chưa hiệu chuẩn lần nào → không có dòng trong view? (view có dòng cho mọi sub-equipment, status not_calibrated)
    sub_equipment_calibration: [
      { sub_equipment_id: 's1', due_date: '2026-09-01', status: 'overdue' },
      { sub_equipment_id: 's2', due_date: '2026-10-20', status: 'due_soon' },
      { sub_equipment_id: 's3', due_date: '2027-05-01', status: 'valid' },
    ],
  }[table] ?? []));
});

describe('getDashboard', () => {
  it('counts every Status in a fixed order and colour, zeros included', async () => {
    const d = await getDashboard();
    expect([d.equipment_total, d.sub_equipment_total, d.golden_total]).toEqual([2, 4, 1]);
    expect(d.by_usage.equipment).toEqual([
      { id: 'in_use', label: null, color: 'green', count: 1 }, { id: 'not_in_use', label: null, color: 'gray', count: 1 },
    ]);
    expect(d.by_usage.sub_equipment.map((i) => i.count)).toEqual([2, 2]);
    expect(d.by_usage.golden_board.map((i) => i.count)).toEqual([1, 0]);
    expect(d.by_calibration_status).toEqual([
      { id: 'not_calibrated', label: null, color: 'gray', count: 1 }, // s4: không có dòng trong view
      { id: 'failed', label: null, color: 'red', count: 0 }, { id: 'overdue', label: null, color: 'red', count: 1 },
      { id: 'due_soon', label: null, color: 'yellow', count: 1 }, { id: 'valid', label: null, color: 'green', count: 1 },
    ]);
  });

  it('counts by tag, location and type over ALL assets; no-type and untagged assets get their own row so the totals reconcile', async () => {
    const d = await getDashboard();
    // 7 assets: s1 carries two tags, so the tag rows add up to 8 here (a legacy multi-tag asset); with one tag each they add up to 7.
    expect(d.by_tag).toEqual([{ id: null, label: null, count: 4 }, { id: 'tg1', label: 'Repair', count: 2 }, { id: 'tg2', label: 'Spare', count: 2 }]);
    expect(d.by_location).toEqual([{ id: 'loc-0', label: 'B3F1', count: 4 }, { id: 'loc-1', label: 'B3F2', count: 3 }]);
    expect(d.by_location.reduce((n, i) => n + i.count, 0)).toBe(d.equipment_total + d.sub_equipment_total + d.golden_total);
    // the golden board has no Type: it is the "No type" row (id null), so the Type rows also add up to all 7 assets.
    expect(d.by_type).toEqual([{ id: 'type-3', label: 'DMM', count: 4 }, { id: 'type-0', label: 'Tester', count: 1 }, { id: 'type-1', label: 'Fixture', count: 1 }, { id: null, label: null, count: 1 }]);
    expect(d.by_type.reduce((n, i) => n + i.count, 0)).toBe(7);
  });

  it('lists overdue and due-soon sub-equipment with their tester, soonest due first', async () => {
    const d = await getDashboard();
    expect(m.selectIn).not.toHaveBeenCalled(); // testers' serials are embedded in the sub-equipment query
    expect(d.overdue).toEqual([{
      id: 's1', serial_number: 'DMM-1', part_number: 'DMM-100', type: 'DMM', tester_serial: 'TESTER-01', location: 'B3F1',
      due_date: '2026-09-01', status: 'overdue',
    }]);
    expect(d.due_soon).toEqual([expect.objectContaining({ id: 's2', tester_serial: null, due_date: '2026-10-20', status: 'due_soon' })]);
  });
});

describe('recentActivities', () => {
  it('one user action = one row (view recent_actions); non-admins never see Configuration or User actions; filters apply to the grouped action', async () => {
    const c = chain({ data: [{ id: 'act-1', module: 'equipment', modules: ['equipment'], action: 'SWAP', source: 'ui', created_at: '2026-10-01T00:00:00Z', created_by: 'u1', item_count: 2, records: [] }] });
    m.from.mockReturnValue(c.proxy);
    const rows = await recentActivities('user', { module: 'sub_equipment', userId: 'u1', search: 'a_b', from: '2026-10-01', limit: 20 });
    expect(m.from).toHaveBeenCalledWith('recent_actions');
    expect(c.call('containedBy')).toEqual(['modules', ['equipment', 'sub_equipment', 'golden_board']]);
    expect(c.call('contains')).toEqual(['modules', ['sub_equipment']]);
    expect(c.call('limit')).toEqual([20]);
    // search matches the name / serial of ANY record of the action
    expect(c.call('ilike')).toEqual(['search_text', '%a\\_b%']);
    expect(rows[0]).toMatchObject({ id: 'act-1', created_by_name: 'Ann', item_count: 2 });

    const admin = chain({ data: [] });
    m.from.mockReturnValue(admin.proxy);
    await recentActivities('admin', {});
    expect(admin.names()).not.toContain('containedBy');
  });

  // TEMPORARY compatibility with a database built before the baseline (the old project). Delete with legacyActivities().
  describe('on a database without recent_actions (no action_id): rows written in ONE transaction are ONE line', () => {
    const missing = () => chain({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.recent_actions' in the schema cache" } });
    const T1 = '2026-10-14T15:55:53.928634+00:00'; // one swap: every row has the same transaction time, user and source
    const T2 = '2026-10-14T11:20:16.262200+00:00';
    const T3 = '2026-10-13T09:00:00.000000+00:00';
    const row = (over: Record<string, unknown>) => ({ module: 'equipment', object_id: 'o', label: 'X', action: 'UPDATE', changes: {}, created_by: 'u1', created_at: T1, note: null, source: 'ui', item_count: 1, ...over });
    const rows = [
      row({ object_id: 'f2', label: 'FIXTURE-2', action: 'CHANGE_LOCATION', note: 'via_parent:BASE-2' }), // followers come in any order …
      row({ object_id: 'b3', label: 'BASE-3', action: 'SWAP', note: 'swap_with:BASE-2' }),
      row({ object_id: 'f3', label: 'FIXTURE-3', action: 'UPDATE', note: 'via_parent:BASE-3' }),
      row({ object_id: 'b2', label: 'BASE-2', action: 'SWAP', note: 'swap_with:BASE-3' }),
      row({ module: 'sub_equipment', object_id: 's1', label: 'DMM-1', action: 'TAGS', created_at: T2 }),
      row({ object_id: 'imp', label: 'IMP-1', action: 'CREATE', created_at: T3, source: 'import', item_count: 3, created_by: 'u2' }),
    ];
    const run = async (role: 'admin' | 'user', filter = {}, data: unknown[] = rows) => {
      const legacy = chain({ data });
      m.from.mockReturnValueOnce(missing().proxy).mockReturnValueOnce(legacy.proxy);
      return { out: await recentActivities(role, filter), legacy };
    };

    it('one swap with the fixtures that travelled with it is ONE line: primary records first, followers after, item_count = every row', async () => {
      const { out, legacy } = await run('admin');
      expect(m.from).toHaveBeenLastCalledWith('recent_activities');
      expect(out).toHaveLength(3); // the swap, the tag change, the import — not 6 lines
      expect(out[0]).toMatchObject({ module: 'equipment', modules: ['equipment'], action: 'SWAP', source: 'ui', created_by: 'u1', created_by_name: 'Ann', created_at: T1, item_count: 4 });
      expect(out[0]!.records.map((r) => [r.label, r.action])).toEqual([['BASE-2', 'SWAP'], ['BASE-3', 'SWAP'], ['FIXTURE-2', 'CHANGE_LOCATION'], ['FIXTURE-3', 'UPDATE']]);
      expect(legacy.call('limit')).toEqual([1000]);
    });

    it('rows of different transactions stay separate lines, newest first; an old import keeps its single representative row', async () => {
      const { out } = await run('admin');
      expect(out.map((a) => [a.action, a.item_count, a.records.length])).toEqual([['SWAP', 4, 4], ['TAGS', 1, 1], ['CREATE', 3, 0]]);
      expect(new Set(out.map((a) => a.id)).size).toBe(3); // unique ids (React keys)
    });

    it('the same time but another user (or source) is another line', async () => {
      const { out } = await run('admin', {}, [row({ label: 'A' }), row({ label: 'B', created_by: 'u2' }), row({ label: 'C', source: 'script' })]);
      expect(out).toHaveLength(3);
    });

    it('filters apply to the whole action: module, any record\'s serial, limit; user and dates go to the database', async () => {
      expect((await run('admin', { module: 'sub_equipment' })).out.map((a) => a.action)).toEqual(['TAGS']);
      expect((await run('admin', { search: 'fixture-3' })).out.map((a) => a.action)).toEqual(['SWAP']); // a follower record matches
      expect((await run('admin', { limit: 1 })).out).toHaveLength(1);
      const { legacy } = await run('admin', { userId: 'u1', from: '2026-10-01', to: '2026-10-31' });
      expect(legacy.call('eq')).toEqual(['created_by', 'u1']);
      expect(legacy.call('gte')).toEqual(['created_at', '2026-10-01']);
      expect(legacy.call('lte')).toEqual(['created_at', '2026-10-31']);
    });

    it('a User never sees an action that touches Configuration or Users', async () => {
      const { out, legacy } = await run('user', {}, [...rows, row({ module: 'configuration', label: 'Locations', created_at: '2026-10-12T00:00:00+00:00' })]);
      expect(legacy.call('in')).toEqual(['module', ['equipment', 'sub_equipment', 'golden_board']]);
      expect(out.every((a) => a.modules.every((x) => ['equipment', 'sub_equipment', 'golden_board'].includes(x)))).toBe(true);
      expect(out.some((a) => a.modules.includes('configuration' as never))).toBe(false);
    });

    it('when the read is cut at 1000 rows the oldest action (possibly cut in half) is dropped, not shown incomplete', async () => {
      const many = Array.from({ length: 1000 }, (_, i) => row({ label: `S-${i}`, created_at: `2026-10-01T00:00:00.${String(Math.floor(i / 2)).padStart(6, '0')}+00:00` }));
      const { out } = await run('admin', { limit: 500 }, many);
      expect(out).toHaveLength(499); // 500 actions of 2 rows were read; the 500th may be incomplete
      expect(out.every((a) => a.item_count === 2)).toBe(true);
    });
  });

  it('any other error from recent_actions is NOT swallowed by the fallback', async () => {
    m.from.mockReturnValueOnce(chain({ data: null, error: { code: '42501', message: 'permission denied' } }).proxy);
    await expect(recentActivities('admin', {})).rejects.toBeTruthy();
    expect(m.from).not.toHaveBeenCalledWith('recent_activities');
  });
});
