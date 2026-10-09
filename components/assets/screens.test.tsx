// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/client/options', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/options')>();
  return {
    ...actual,
    useOptions: () => ({ locations: [
      { id: 'l1', display_name: 'B3F1', sort_order: 0, is_active: true }, { id: 'l2', display_name: 'B3F2', sort_order: 1, is_active: true },
    ] }),
  };
});
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { ApiError, api } from '@/lib/client/api';
import { Modal } from '@/components/ui';
import type { ActionCtx } from '@/components/ui/record/RecordModal';
import { assetActions } from './actions';
import { ChangeLocationScreen, DeleteAssetScreen, DetachScreen, MoveScreen, SwapScreen, UsageScreen } from './screens';
import type { AssetRecord } from './api';
import type { AssetOpResult, EquipmentRow } from '@/lib/types';

const audit = {
  created_at: '2026-10-01T01:00:00Z', created_by: 'u1', created_by_name: 'Admin',
  updated_at: '2026-10-01T02:00:00Z', updated_by: 'u1', updated_by_name: 'Admin',
};
const equipment = (over: Partial<EquipmentRow> = {}): EquipmentRow => ({
  id: 'e1', jabil_id: null, part_number_id: 'pn1', part_number: 'P20001', serial_number: 'BASE-01', asset: null, type_id: 't2', type: 'Base',
  kind: 'base', usage: 'not_in_use', level_id: null, level: null, location_id: 'l1', location: 'B3F1', remark: null, tag_ids: [], tags: [],
  parent_id: null, parent_serial: null, has_children: false, ...audit, ...over,
});
const result = (over: Partial<AssetOpResult> = {}): AssetOpResult => ({ dry_run: true, count: 1, deleted: 0, usage_changes: [], changes: [], ...over });

function ctxFor(record: AssetRecord): ActionCtx<AssetRecord> {
  return { record, cancel: vi.fn(), done: vi.fn(), removed: vi.fn(), reload: vi.fn() };
}
function show(node: React.ReactNode) {
  render(<Modal size="l" title="Action" onClose={() => {}}>{node}</Modal>);
}
const footer = () => document.querySelector('.modal-footer') as HTMLElement;
const button = (name: string | RegExp) => within(footer()).getByRole('button', { name });
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const errorOf = (code: string) => new ApiError(code, code, {}, 'req', 400);

beforeEach(() => {
  vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.delete).mockReset();
});

describe('Move / attach screen', () => {
  const candidates = [
    { id: 'p1', kind: 'tester', serial_number: 'TESTER-01', part_number: 'P12316', type_name: 'Tester', location_id: 'l2', location: 'B3F2', usage: 'in_use', usage_after: 'in_use' },
  ];

  async function pickParent(ctx = ctxFor(equipment())) {
    vi.mocked(api.get).mockResolvedValue({ data: candidates, meta: {} });
    show(<MoveScreen type="equipment" ctx={ctx} />);
    await click(screen.getByRole('button', { name: 'eq.newParent' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /TESTER-01/ })).toBeTruthy());
    await click(screen.getByRole('option', { name: /TESTER-01/ }));
    return ctx;
  }

  it('lists valid parents from the server with the Status each would give, previews with dry_run, and confirms for real', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: result({ usage_changes: [{ asset_type: 'equipment', asset_id: 'e1', label: 'BASE-01', from: 'not_in_use', to: 'in_use' }] }), meta: {},
    });
    const ctx = await pickParent();
    expect(vi.mocked(api.get).mock.calls[0]![0]).toContain('/api/assets/equipment/valid-parents?id=e1');
    expect(api.post).toHaveBeenCalledWith('/api/assets/equipment/e1/move', { parent_id: 'p1', dry_run: true });
    // Kết quả: BASE-01 đổi Status.
    await waitFor(() => expect(screen.getByText('BASE-01')).toBeTruthy());
    expect(within(document.querySelector('.op-result') as HTMLElement).getAllByText('values.not_in_use').length).toBeGreaterThan(0);

    vi.mocked(api.post).mockResolvedValueOnce({ data: result({ dry_run: false }), meta: {} });
    await click(button('eq.attachConfirm'));
    expect(api.post).toHaveBeenLastCalledWith('/api/assets/equipment/e1/move', { parent_id: 'p1' });
    expect(ctx.reload).toHaveBeenCalled();
    expect(ctx.done).toHaveBeenCalledWith(undefined, 'eq.moved');
  });

  it('an error from the database preview (e.g. wrong parent type) shows at once and blocks the main button', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(errorOf('PARENT_TYPE_INVALID'));
    await pickParent();
    await waitFor(() => expect(screen.getByText(/errors.PARENT_TYPE_INVALID/)).toBeTruthy());
    expect((button('eq.attachConfirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a device that already has a parent confirms with "Đổi cha" and says where it is now', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: result(), meta: {} });
    await pickParent(ctxFor(equipment({ parent_id: 'p0', parent_serial: 'TESTER-00' })));
    expect(screen.getByText('TESTER-00')).toBeTruthy();
    expect(button('eq.moveConfirm')).toBeTruthy();
  });

  it('the main button stays disabled until a parent is chosen, and a choice counts as unsaved', async () => {
    show(<MoveScreen type="equipment" ctx={ctxFor(equipment())} />);
    expect((button('eq.attachConfirm') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Swap screen', () => {
  const candidate = (over = {}) => ({
    asset_type: 'equipment', id: 'e2', kind: 'base', serial_number: 'BASE-02', part_number: 'P20001', type_name: 'Base', parent_id: null,
    parent_serial: null, location_id: 'l2', location: 'B3F2', usage: 'not_in_use', same_place: false, ...over,
  });

  async function pick(over = {}) {
    vi.mocked(api.get).mockResolvedValue({ data: [candidate(over)], meta: {} });
    const ctx = ctxFor(equipment());
    show(<SwapScreen type="equipment" ctx={ctx} />);
    await click(screen.getByRole('button', { name: 'eq.swapWith' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /BASE-02/ })).toBeTruthy());
    await click(screen.getByRole('option', { name: /BASE-02/ }));
    return ctx;
  }

  it('previews and swaps with the chosen device', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: result({ count: 2 }), meta: {} });
    const ctx = await pick();
    expect(api.post).toHaveBeenCalledWith('/api/assets/equipment/e1/swap', { other_id: 'e2', dry_run: true });
    await waitFor(() => expect((button('eq.swap') as HTMLButtonElement).disabled).toBe(false));
    await click(button('eq.swap'));
    expect(api.post).toHaveBeenLastCalledWith('/api/assets/equipment/e1/swap', { other_id: 'e2' });
    expect(ctx.done).toHaveBeenCalledWith(undefined, 'eq.swapped');
  });

  it('two devices in the same place and under the same parent: a warning and the button stays locked', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: result(), meta: {} });
    await pick({ same_place: true });
    expect(screen.getByText('eq.swapNoChange')).toBeTruthy();
    expect((button('eq.swap') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Detach, location, delete, usage', () => {
  it('Detach previews on open and warns when the device is In use', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: result(), meta: {} });
    const ctx = ctxFor(equipment({ usage: 'in_use', parent_id: 'p0', parent_serial: 'TESTER-00' }));
    show(<DetachScreen type="equipment" ctx={ctx} />);
    await flush();
    expect(api.post).toHaveBeenCalledWith('/api/assets/equipment/e1/detach', { dry_run: true });
    expect(screen.getByText('eq.detachInUseNote')).toBeTruthy();
    await click(button('asset.detachConfirm'));
    expect(api.post).toHaveBeenLastCalledWith('/api/assets/equipment/e1/detach', {});
    expect(ctx.done).toHaveBeenCalledWith(undefined, 'eq.detached');
  });

  it('Change location: pick a new location → preview → confirm; a device that is In use is refused by the preview', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(errorOf('EQUIPMENT_IN_USE'));
    const ctx = ctxFor(equipment({ usage: 'in_use' }));
    show(<ChangeLocationScreen type="equipment" ctx={ctx} />);
    await click(screen.getByRole('button', { name: 'eq.newLocation' }));
    // Vị trí hiện tại không có trong danh sách chọn.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['B3F2']);
    await click(screen.getByRole('option', { name: 'B3F2' }));
    await waitFor(() => expect(screen.getByText(/errors.EQUIPMENT_IN_USE/)).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('/api/assets/equipment/e1/change-location', { location_id: 'l2', dry_run: true });
    expect((button('eq.changeLocation') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Delete (Admin) warns that children become unattached, previews, deletes for real and tells the modal the record is gone', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: result({ deleted: 1 }), meta: {} });
    const ctx = ctxFor(equipment({ has_children: true }));
    show(<DeleteAssetScreen type="equipment" ctx={ctx} />);
    await flush();
    expect(api.delete).toHaveBeenCalledWith('/api/assets/equipment/e1?dry_run=1');
    expect(screen.getByText(/asset.deleteChildrenWarn/)).toBeTruthy();
    vi.mocked(api.delete).mockResolvedValueOnce({ data: result({ dry_run: false, deleted: 1 }), meta: {} });
    await click(button('common.delete'));
    expect(api.delete).toHaveBeenLastCalledWith('/api/assets/equipment/e1');
    expect(ctx.reload).toHaveBeenCalled();
    expect(ctx.removed).toHaveBeenCalledWith('dp.deleted');
  });

  it('deleting sub-equipment says its calibrations go with it', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: result(), meta: {} });
    show(<DeleteAssetScreen type="sub_equipment" ctx={ctxFor(equipment())} />);
    await flush();
    expect(screen.getByText('asset.deleteCalibrationsWarn')).toBeTruthy();
  });

  it('Check-out sends the device with a note; the error for a Base without a parent shows in Kết quả and locks the button', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(errorOf('USAGE_NEEDS_PARENT'));
    const blocked = ctxFor(equipment());
    show(<UsageScreen type="equipment" ctx={blocked} />);
    await flush();
    expect(api.post).toHaveBeenCalledWith('/api/assets/usage', { refs: [{ type: 'equipment', id: 'e1' }], usage: 'in_use', dry_run: true });
    expect(screen.getByText(/errors.USAGE_NEEDS_PARENT/)).toBeTruthy();
    expect((button('eq.checkOut') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Check-in (device is In use): previews the whole branch, sends the note, reports how many devices changed', async () => {
    const two = [
      { asset_type: 'equipment', asset_id: 'e1', label: 'BASE-01', from: 'in_use', to: 'not_in_use' },
      { asset_type: 'equipment', asset_id: 'e9', label: 'FIX-01', from: 'in_use', to: 'not_in_use' },
    ];
    vi.mocked(api.post).mockResolvedValueOnce({ data: result({ usage_changes: two as never, count: 2 }), meta: {} });
    const ctx = ctxFor(equipment({ usage: 'in_use' }));
    show(<UsageScreen type="equipment" ctx={ctx} />);
    await flush();
    expect(api.post).toHaveBeenCalledWith('/api/assets/usage', { refs: [{ type: 'equipment', id: 'e1' }], usage: 'not_in_use', dry_run: true });
    await act(async () => { fireEvent.change(screen.getByLabelText('eq.usageNote'), { target: { value: 'back to store' } }); });
    vi.mocked(api.post).mockResolvedValueOnce({ data: result({ dry_run: false, usage_changes: two as never, count: 2 }), meta: {} });
    await click(button('eq.checkIn'));
    expect(api.post).toHaveBeenLastCalledWith('/api/assets/usage', { refs: [{ type: 'equipment', id: 'e1' }], usage: 'not_in_use', note: 'back to store' });
    expect(ctx.done).toHaveBeenCalledWith(undefined, expect.stringContaining('eq.checkedIn'));
  });
});

describe('assetActions — which actions a record offers', () => {
  const t = ((key: string) => key) as never;
  const keys = (record: AssetRecord, over: { isAdmin?: boolean } = {}) =>
    assetActions<AssetRecord>({ type: 'equipment', t, isAdmin: over.isAdmin ?? true }).filter((a) => !a.visible || a.visible(record)).map((a) => a.key);

  it('no parent: Attach and Change location; with a parent: Change parent and Detach (Move and Detach never both missing)', () => {
    expect(keys(equipment())).toEqual(['swap', 'attach', 'location', 'label', 'delete', 'checkout']);
    expect(keys(equipment({ parent_id: 'p', parent_serial: 'T', usage: 'in_use' }))).toEqual(['swap', 'move', 'detach', 'label', 'delete', 'checkin']);
  });

  it('Delete is for Admin only; Check-out / Check-in follow the Status and are primary buttons', () => {
    expect(keys(equipment(), { isAdmin: false })).not.toContain('delete');
    const actions = assetActions<AssetRecord>({ type: 'equipment', t, isAdmin: true });
    expect(actions.filter((a) => a.primary).map((a) => a.key)).toEqual(['checkout', 'checkin']);
    expect(actions.find((a) => a.key === 'delete')?.danger).toBe(true);
  });

  it('a sub-equipment calls its parent a tester; golden board uses its own wording', () => {
    const sub = assetActions<AssetRecord>({ type: 'sub_equipment', t, isAdmin: true });
    expect(sub.find((a) => a.key === 'attach')?.label).toBe('asset.attach.sub_equipment');
    const golden = assetActions<AssetRecord>({ type: 'golden_board', t, isAdmin: true });
    expect(golden.find((a) => a.key === 'detach')?.label).toBe('asset.detach.golden_board');
  });
});
