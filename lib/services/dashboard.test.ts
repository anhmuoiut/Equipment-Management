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
});
