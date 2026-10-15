import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('./db', () => ({ rpc: m.rpc, db: () => ({ from: m.from }) }));
vi.mock('./history', () => ({
  withActorNames: async (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, created_by_name: r.created_by ? 'Ann' : null })),
}));
vi.mock('./lookups', async () => ({
  ...(await vi.importActual<typeof import('./lookups')>('./lookups')),
  loadLookups: async () => (await import('../testing/fixtures')).makeLookups(),
}));

import { chain } from '../testing/chain';
import { AppError } from '@/lib/errors';
import {
  applyTreeEdit, assetLog, assetOps, changeAssetLocation, logChanges,
  parseAssetType, previewTreeEdit, serialMatches, swapCandidates, validParents,
} from './assets';

beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockResolvedValue({ dry_run: false, count: 0, deleted: 0, usage_changes: [], changes: [] });
});

describe('parseAssetType', () => {
  it('accepts the three tables and refuses anything else with NOT_FOUND', () => {
    expect(['equipment', 'sub_equipment', 'golden_board'].map(parseAssetType)).toEqual(['equipment', 'sub_equipment', 'golden_board']);
    for (const bad of ['golden_boards', 'calibration', '', null, undefined]) expect(() => parseAssetType(bad)).toThrow(AppError);
    try { parseAssetType('x'); } catch (e) { expect((e as AppError).code).toBe('NOT_FOUND'); }
  });
});

describe('assetOps — một hàm database cho mỗi thao tác, dry run là tham số', () => {
  it('maps each operation to its database function and arguments', async () => {
    await assetOps.changeLocation('equipment', 'a', 'l1', 'u1');
    await assetOps.move('sub_equipment', 'a', 'p1', 'u1', true);
    await assetOps.detach('golden_board', 'a', 'u1');
    await assetOps.swap('equipment', 'a', 'b', 'u1', true);
    await assetOps.remove('equipment', 'a', 'u1');
    await assetOps.setUsage([{ type: 'equipment', id: 'a' }], 'in_use', 'note', 'u1');
    expect(m.rpc.mock.calls).toEqual([
      ['asset_change_location', { p_type: 'equipment', p_id: 'a', p_location_id: 'l1', p_actor: 'u1', p_dry_run: false }],
      ['asset_move', { p_type: 'sub_equipment', p_id: 'a', p_parent_id: 'p1', p_actor: 'u1', p_dry_run: true }],
      ['asset_detach', { p_type: 'golden_board', p_id: 'a', p_actor: 'u1', p_dry_run: false }],
      ['asset_swap', { p_type: 'equipment', p_a: 'a', p_b: 'b', p_actor: 'u1', p_dry_run: true }],
      ['asset_delete', { p_type: 'equipment', p_id: 'a', p_actor: 'u1', p_dry_run: false }],
      ['asset_set_usage', { p_refs: [{ type: 'equipment', id: 'a' }], p_usage: 'in_use', p_actor: 'u1', p_note: 'note', p_dry_run: false }],
    ]);
  });

  it('returns the result of the database as is (same shape for a dry run and the real call)', async () => {
    const result = { dry_run: true, count: 2, deleted: 0, usage_changes: [{ asset_type: 'equipment', asset_id: 'a', label: 'SN', from: 'in_use', to: 'not_in_use' }], changes: [] };
    m.rpc.mockResolvedValue(result);
    expect(await assetOps.move('equipment', 'a', 'p', 'u1', true)).toBe(result);
  });

  it('passes the database error through (EQUIPMENT_IN_USE, SWAP_NO_CHANGE…)', async () => {
    m.rpc.mockRejectedValue(new AppError('EQUIPMENT_IN_USE'));
    await expect(assetOps.remove('equipment', 'a', 'u1')).rejects.toMatchObject({ code: 'EQUIPMENT_IN_USE' });
  });
});

describe('changeAssetLocation', () => {
  it('only a location that is still in use can be chosen — nothing reaches the database otherwise', async () => {
    await expect(changeAssetLocation('equipment', 'a', 'loc-2', 'u1')).rejects.toMatchObject({ code: 'INACTIVE_OPTION' });
    await expect(changeAssetLocation('equipment', 'a', 'nope', 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.rpc).not.toHaveBeenCalled();
    await changeAssetLocation('equipment', 'a', 'loc-1', 'u1', true);
    expect(m.rpc).toHaveBeenCalledWith('asset_change_location', { p_type: 'equipment', p_id: 'a', p_location_id: 'loc-1', p_actor: 'u1', p_dry_run: true });
  });
});

describe('tra cứu cho màn hình thao tác', () => {
  it('valid parents: existing asset by id, new asset by kind, with defaults', async () => {
    m.rpc.mockResolvedValue([{ id: 'p' }]);
    expect(await validParents('golden_board', { id: 'g' })).toEqual([{ id: 'p' }]);
    await validParents('equipment', { kind: 'fixture', q: 'ba', limit: 10 });
    expect(m.rpc.mock.calls).toEqual([
      ['valid_parents', { p_type: 'golden_board', p_id: 'g', p_kind: null, p_q: null, p_limit: 50 }],
      ['valid_parents', { p_type: 'equipment', p_id: null, p_kind: 'fixture', p_q: 'ba', p_limit: 10 }],
    ]);
    m.rpc.mockResolvedValue(null);
    expect(await validParents('sub_equipment', { id: 's' })).toEqual([]);
  });

  it('swap candidates', async () => {
    m.rpc.mockResolvedValue([]);
    await swapCandidates('equipment', 'a', 'q');
    expect(m.rpc.mock.calls).toEqual([
      ['swap_candidates', { p_type: 'equipment', p_id: 'a', p_q: 'q', p_limit: 50 }],
    ]);
  });

  it('serial matches: a blank serial asks nothing; the edited record can be excluded', async () => {
    expect(await serialMatches('   ')).toEqual([]);
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue([{ asset_type: 'golden_board', id: 'g', serial_number: 'SN', part_number: 'P', location: 'B3F1' }]);
    expect((await serialMatches('SN', { type: 'equipment', id: 'e' }))).toHaveLength(1);
    expect(m.rpc).toHaveBeenCalledWith('serial_matches', { p_serial: 'SN', p_exclude_type: 'equipment', p_exclude_id: 'e' });
  });
});

describe('nhật ký tài sản', () => {
  it('logChanges rebuilds { field: { old, new } } like the database function asset_log_changes', () => {
    expect(logChanges({ usage: 'in_use', location: 'B3F1' }, { usage: 'not_in_use', serial_number: 'X' })).toEqual({
      usage: { old: 'in_use', new: 'not_in_use' }, location: { old: 'B3F1', new: null }, serial_number: { old: null, new: 'X' },
    });
    expect(logChanges(null, { serial_number: 'X' })).toEqual({ serial_number: { old: null, new: 'X' } });
    expect(logChanges(null, null)).toEqual({});
  });

  it('assetLog reads the newest first, can keep only some actions, and names the people', async () => {
    const row = {
      id: 'l1', label: 'SN-1', action: 'CALIBRATE', old_value: null, new_value: { due_date: '2027-01-01' },
      from_location: null, to_location: null, reason: 'via_parent:T', source: 'ui', user_id: 'u1', created_at: '2026-10-01T00:00:00Z',
    };
    const all = chain({ data: [row] });
    m.from.mockReturnValueOnce(all.proxy);
    expect(await assetLog('sub_equipment', 's1')).toEqual([{
      id: 'l1', label: 'SN-1', action: 'CALIBRATE', changes: { due_date: { old: null, new: '2027-01-01' } }, note: 'via_parent:T',
      source: 'ui', created_at: '2026-10-01T00:00:00Z', created_by: 'u1', created_by_name: 'Ann', from_location: null, to_location: null,
    }]);
    expect(m.from).toHaveBeenCalledWith('asset_logs');
    expect(all.call('eq')).toEqual(['asset_type', 'sub_equipment']);
    expect(all.names()).not.toContain('in');

    const only = chain({ data: [] });
    m.from.mockReturnValueOnce(only.proxy);
    await assetLog('sub_equipment', 's1', ['CALIBRATE', 'CALIBRATION_UPDATE']);
    expect(only.call('in')).toEqual(['action', ['CALIBRATE', 'CALIBRATION_UPDATE']]);
  });
});

describe('TreeEdit — đổi cha / vị trí khi sửa form', () => {
  it('preview dry-runs only the parent step (Move or Detach); the location step only when the parent stays', async () => {
    await previewTreeEdit('sub_equipment', 's', { parentTo: 'p' }, 'u1');
    await previewTreeEdit('sub_equipment', 's', { parentTo: null, location: 'loc-1' }, 'u1');
    await previewTreeEdit('sub_equipment', 's', { location: 'loc-1' }, 'u1');
    await previewTreeEdit('sub_equipment', 's', {}, 'u1');
    expect(m.rpc.mock.calls.map(([fn, args]) => [fn, args.p_dry_run])).toEqual([
      ['asset_move', true], ['asset_detach', true], ['asset_change_location', true],
    ]);
  });

  it('apply runs the parent step then the location step, for real', async () => {
    await applyTreeEdit('golden_board', 'g', { parentTo: null, location: 'loc-1' }, 'u1');
    expect(m.rpc.mock.calls.map(([fn, args]) => [fn, args.p_dry_run])).toEqual([['asset_detach', false], ['asset_change_location', false]]);
    m.rpc.mockClear();
    await applyTreeEdit('golden_board', 'g', {}, 'u1');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
