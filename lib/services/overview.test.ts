import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./core/db', () => ({ rpc: m.rpc }));

import { assertOverviewFilter, overviewBoard } from './overview';

/** Một dòng của overview_board. */
const card = (over: Record<string, unknown>) => ({
  location_id: 'loc-1', location: 'B3F1', root_id: 'T1', asset_type: 'equipment', id: 'T1', kind: 'tester', type_name: 'Tester',
  part_number: 'P12316', serial_number: 'T1', usage: 'not_in_use', cal_alert: null, parent_id: null, depth: 0,
  descendants: 0, alerts: 0, matched: false, pos: 1, ...over,
});

beforeEach(() => vi.resetAllMocks());

describe('overviewBoard — một lần gọi, gom thành Location → cột → thẻ', () => {
  it('asks the database once, with the three filters (null when not set)', async () => {
    m.rpc.mockResolvedValue([]);
    await overviewBoard();
    await overviewBoard({ usage: 'in_use', kind: 'base', q: '  ab-1  ' });
    expect(m.rpc.mock.calls).toEqual([
      ['overview_board', { p_usage: null, p_kind: null, p_q: null }],
      ['overview_board', { p_usage: 'in_use', p_kind: 'base', p_q: 'ab-1' }],
    ]);
  });

  it('no assets → no sections (the page shows its empty state)', async () => {
    m.rpc.mockResolvedValue([]);
    expect(await overviewBoard()).toEqual({ sections: [] });
    m.rpc.mockResolvedValue(null);
    expect(await overviewBoard()).toEqual({ sections: [] });
  });

  it('groups the rows by Location and column in the order the database gave them; cards of a column are drawn by pos', async () => {
    m.rpc.mockResolvedValue([
      card({ id: 'T1', root_id: 'T1', serial_number: 'T1', descendants: 6, alerts: 2, cal_alert: 'overdue' }),
      card({ id: 'S2', root_id: 'T1', asset_type: 'sub_equipment', kind: 'sub_equipment', type_name: 'DMM', serial_number: 'S2', parent_id: 'T1', depth: 1, cal_alert: 'due_soon', pos: 3 }),
      card({ id: 'S1', root_id: 'T1', asset_type: 'sub_equipment', kind: 'sub_equipment', type_name: 'DMM', serial_number: 'S1', parent_id: 'T1', depth: 1, cal_alert: 'overdue', pos: 2 }),
      card({ id: 'L1', root_id: 'L1', kind: 'base', type_name: 'Base', serial_number: 'L1', descendants: 0 }),
      card({ location_id: 'loc-2', location: 'B3F2', id: 'T9', root_id: 'T9', serial_number: 'T9', usage: 'in_use' }),
    ]);
    const { sections } = await overviewBoard();
    expect(sections.map((s) => [s.location, s.columns.map((c) => c.root_id)])).toEqual([['B3F1', ['T1', 'L1']], ['B3F2', ['T9']]]);
    const column = sections[0]!.columns[0]!;
    expect(column.cards.map((c) => c.serial_number)).toEqual(['T1', 'S1', 'S2']);
    expect(column.cards[1]).toMatchObject({ asset_type: 'sub_equipment', kind: 'sub_equipment', type_name: 'DMM', cal_alert: 'overdue', parent_id: 'T1', depth: 1, matched: false });
  });

  it('"+N" = the root\'s descendants minus the cards shown below it; never negative', async () => {
    m.rpc.mockResolvedValue([
      card({ descendants: 9 }),
      card({ id: 'a', parent_id: 'T1', depth: 1, kind: 'base', pos: 2 }), card({ id: 'b', parent_id: 'T1', depth: 1, kind: 'base', pos: 3 }),
      card({ id: 'c', parent_id: 'T1', depth: 1, kind: 'base', pos: 4 }),
      card({ root_id: 'T2', id: 'T2', serial_number: 'T2', descendants: 1 }), card({ root_id: 'T2', id: 'x', parent_id: 'T2', depth: 1, pos: 2 }),
      card({ root_id: 'T3', id: 'T3', serial_number: 'T3', descendants: 0 }), card({ root_id: 'T3', id: 'y', parent_id: 'T3', depth: 1, pos: 2 }),
    ]);
    const columns = (await overviewBoard()).sections[0]!.columns;
    expect(columns.map((c) => c.more)).toEqual([6, 0, 0]);
  });

  it('section header: testers = Tester columns, In use = In use columns, ⚠ = sum of alerts, colour = worst alert of the columns', async () => {
    m.rpc.mockResolvedValue([
      card({ root_id: 'T1', id: 'T1', usage: 'in_use', alerts: 2, cal_alert: 'due_soon' }),
      card({ root_id: 'T2', id: 'T2', usage: 'not_in_use', alerts: 1, cal_alert: 'failed' }),
      card({ root_id: 'B1', id: 'B1', kind: 'base', usage: 'not_in_use' }),
      card({ location_id: 'loc-2', location: 'B3F2', root_id: 'T3', id: 'T3', usage: 'in_use', alerts: 1, cal_alert: 'due_soon' }),
      card({ location_id: 'loc-3', location: 'B3F3', root_id: 'T4', id: 'T4' }),
    ]);
    const [a, b, c] = (await overviewBoard()).sections;
    expect([a!.testers, a!.in_use, a!.alerts, a!.worst]).toEqual([2, 1, 3, 'failed']);
    expect([b!.testers, b!.in_use, b!.alerts, b!.worst]).toEqual([1, 1, 1, 'due_soon']);
    expect([c!.testers, c!.in_use, c!.alerts, c!.worst]).toEqual([1, 0, 0, null]);
  });

  it('a column keeps which cards matched the filter', async () => {
    m.rpc.mockResolvedValue([card({}), card({ id: 'k', parent_id: 'T1', depth: 1, kind: 'base', matched: true, pos: 2 })]);
    const cards = (await overviewBoard({ q: 'k' })).sections[0]!.columns[0]!.cards;
    expect(cards.map((c) => c.matched)).toEqual([false, true]);
  });

  it('a database error is passed on, not swallowed', async () => {
    m.rpc.mockRejectedValue(new Error('boom'));
    await expect(overviewBoard()).rejects.toThrow('boom');
  });
});

describe('assertOverviewFilter', () => {
  it('accepts the three filters (empty = not set, the search text is trimmed)', () => {
    expect(assertOverviewFilter({})).toEqual({ usage: null, kind: null, q: null });
    expect(assertOverviewFilter({ usage: '', kind: '', q: '   ' })).toEqual({ usage: null, kind: null, q: null });
    expect(assertOverviewFilter({ usage: 'in_use', kind: 'golden_board', q: ' x ' })).toEqual({ usage: 'in_use', kind: 'golden_board', q: 'x' });
    for (const kind of ['tester', 'base', 'fixture', 'sub_equipment', 'golden_board']) expect(assertOverviewFilter({ kind }).kind).toBe(kind);
  });

  it('refuses an unknown Status / kind and an over-long search, naming the field', () => {
    expect(() => assertOverviewFilter({ usage: 'maybe' })).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR', details: { fields: { usage: 'invalid' } } }));
    expect(() => assertOverviewFilter({ kind: 'robot' })).toThrowError(expect.objectContaining({ details: { fields: { kind: 'invalid' } } }));
    expect(() => assertOverviewFilter({ q: 'x'.repeat(101) })).toThrowError(expect.objectContaining({ details: { fields: { q: 'too_long' } } }));
    expect(() => assertOverviewFilter({ usage: 'x', kind: 'y' })).toThrowError(expect.objectContaining({ details: { fields: { usage: 'invalid', kind: 'invalid' } } }));
  });
});
