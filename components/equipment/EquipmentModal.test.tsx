// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/equipment', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

import { base, equipmentRows, options, spare, tester, treeResponse } from '@/lib/client/testing/assetFixtures';

function respond(url: string): { data: unknown; meta?: Record<string, unknown> } {
  const [path] = url.split('?');
  if (path === '/api/options') return { data: options };
  if (path === '/api/equipment') return { data: equipmentRows };
  const one = path!.match(/^\/api\/equipment\/([^/]+)$/);
  if (one) return { data: equipmentRows.find((r) => r.id === one[1]) };
  if (path!.endsWith('/tree')) return { data: treeResponse };
  if (path!.endsWith('/history')) return { data: [] };
  if (path === '/api/assets/serial-matches') return { data: [] };
  if (path!.startsWith('/api/assets/') && path!.endsWith('/valid-parents')) return { data: [] };
  throw new Error('unexpected GET ' + url);
}
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async (url: string) => ({ meta: {}, ...respond(url) })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { ApiError, api } from '@/lib/client/api';
import { resetUrl, currentSearch } from '@/lib/client/testing/urlParamsMock';
import { ViewerProvider } from '@/components/ViewerContext';
import { EquipmentWorkspace } from './EquipmentWorkspace';
import type { Role } from '@/lib/permissions';

async function mount(role: Role = 'admin', node: ReactNode = <EquipmentWorkspace />) {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role }}>{node}</ViewerProvider>);
  });
}
const dialog = () => screen.getByRole('dialog');
const footer = () => dialog().querySelector('.modal-footer') as HTMLElement;
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const openRow = async (serial: string) => {
  await click(screen.getAllByText(serial, { selector: 'td *, td' })[0]!);
  await waitFor(() => expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe(serial));
};
const title = () => within(dialog()).getByRole('heading', { level: 2 }).textContent;

beforeEach(() => { resetUrl(); push.mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); });

describe('Equipment — masterlist', () => {
  it('shows the parent/child column, Status first, and the default columns; Chưa gắn is a quick filter', async () => {
    await mount();
    expect(screen.getByText('TESTER-01')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => /fields.usage/.test(h))).toBe(true);
    expect(headers.some((h) => /fields.serial_number/.test(h))).toBe(true);
    expect(headers.some((h) => /fields.remark/.test(h))).toBe(false); // cột phụ ẩn mặc định
    expect(document.querySelectorAll('.rel').length).toBe(3); // tester (có con), base (có con), fixture (có con) — spare không có gì
    await click(screen.getByRole('button', { name: /asset.quickUnattached/ }));
    expect(screen.queryByText('TESTER-01')).toBeNull(); // Tester không có cha và không tính là "chưa gắn"
    expect(screen.getByText('BASE-02')).toBeTruthy();
  });
});

describe('Equipment — modal', () => {
  it('opens as an L modal with the header facts, field groups, relations and the common footer', async () => {
    await mount();
    await openRow('BASE-01');
    expect(dialog().classList.contains('modal-dialog--l')).toBe(true);
    expect(currentSearch()).toBe('id=e-base');
    expect(within(dialog()).getByText('P20001 · Base')).toBeTruthy();
    // Nhóm Vị trí & quan hệ: chip cha, chip con (Fixture); Base không có sub-equipment / golden.
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /FIXTURE-01/ })).toBeTruthy());
    expect(within(dialog()).getByRole('button', { name: /TESTER-01/ })).toBeTruthy();
    expect(within(dialog()).queryByText('asset.subEquipment')).toBeNull();
    // Footer: [Thao tác ▾] trái; [Sửa] [Check-in] phải (đang In use).
    const buttons = within(footer()).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['dp.actionsMenu', 'common.edit', 'eq.checkIn']);
    expect(within(footer()).getByRole('button', { name: 'eq.checkIn' }).className).toContain('ui-button--primary');
  });

  it('the actions menu: add child, swap, change parent, detach, print label, delete (red, last) — in this order', async () => {
    await mount();
    await openRow('BASE-01');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['eq.addChild', 'eq.swap', 'asset.changeParent.equipment', 'asset.detach.equipment', 'label.print', 'common.delete']);
    expect(screen.getAllByRole('menuitem').at(-1)!.getAttribute('data-danger')).toBe('true');
  });

  it('a User (not Admin) does not get Delete; a Readonly viewer gets only [Đóng]', async () => {
    await mount('user');
    await openRow('BASE-01');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    expect(screen.queryByRole('menuitem', { name: 'common.delete' })).toBeNull();
  });

  it('Readonly: only [Đóng] in the footer and no add / import buttons', async () => {
    await mount('readonly');
    expect(screen.queryByRole('button', { name: /imp.button/ })).toBeNull();
    expect(document.querySelector('.ws-add-fab')).toBeNull();
    await openRow('BASE-01');
    expect(within(footer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['common.close']);
  });

  it('clicking the parent chip opens it inside the same modal with a breadcrumb ← BASE-01 › TESTER-01', async () => {
    await mount();
    await openRow('BASE-01');
    await click(within(dialog()).getByRole('button', { name: /TESTER-01/ }));
    await waitFor(() => expect(title()).toBe('TESTER-01'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(currentSearch()).toBe('id=e-tester');
    expect(within(dialog()).getByRole('button', { name: 'BASE-01' })).toBeTruthy();
  });

  it('a Tester lists its sub-equipment (with Calibration Status); clicking one goes to that module with ?id=', async () => {
    await mount();
    await openRow('TESTER-01');
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
    expect(within(dialog()).getAllByRole('button', { name: /DMM-100/ })).toHaveLength(2);
    expect(within(dialog()).getByText('cal.status.overdue')).toBeTruthy();
    await click(within(dialog()).getByRole('button', { name: /DMM-2/ }));
    expect(push).toHaveBeenCalledWith('/calibration?id=s2');
  });

  it('a Fixture lists its golden boards; clicking one goes to the Golden module with ?id=', async () => {
    await mount();
    await openRow('FIXTURE-01');
    await click(await within(dialog()).findByRole('button', { name: /GB-1/ }));
    expect(push).toHaveBeenCalledWith('/golden?id=g1');
  });

  it('when the tree cannot be loaded the relation rows say so with Retry (never "Loading…" forever); Retry loads them', async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    let failures = 1;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tree') && failures-- > 0) throw new ApiError('SERVER_ERROR', 'x', {}, '-', 500);
      return get(url);
    });
    try {
      await mount();
      await openRow('TESTER-01');
      await waitFor(() => expect(within(dialog()).queryAllByRole('button', { name: 'common.retry' }).length).toBeGreaterThan(0));
      expect(within(dialog()).queryByText('common.loadingEllipsis')).toBeNull();
      await click(within(dialog()).getAllByRole('button', { name: 'common.retry' })[0]!);
      await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
      expect(within(dialog()).queryByRole('button', { name: 'common.retry' })).toBeNull();
    } finally {
      vi.mocked(api.get).mockImplementation(get);
    }
  });

  it('the children, the Calibration summary and the Tree tab come from ONE tree request per record', async () => {
    vi.mocked(api.get).mockClear();
    await mount();
    await openRow('TESTER-01');
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
    await click(within(dialog()).getByRole('tab', { name: 'eq.tabTree' }));
    await waitFor(() => expect(within(dialog()).getByRole('tree')).toBeTruthy());
    const treeCalls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/equipment/e-tester/tree'));
    expect(treeCalls).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.some((c) => String(c[0]).startsWith('/api/overview'))).toBe(false);
  });

  it('a Tester shows the read-only Calibration summary and a link to Calibration filtered by this tester', async () => {
    await mount();
    await openRow('TESTER-01');
    await waitFor(() => expect(within(dialog()).getByText(/asset.calibrationSummary/)).toBeTruthy());
    expect(within(dialog()).getByText(/asset.calibrationSummary/).textContent).toContain('"overdue":1');
    await click(within(dialog()).getByRole('button', { name: 'asset.viewInCalibration' }));
    expect(push).toHaveBeenCalledWith('/calibration?q=TESTER-01');
  });

  it('a Base has no Calibration group; a device without a parent offers "Gắn vào thiết bị cha" which opens the Move screen', async () => {
    await mount();
    await openRow('BASE-02');
    expect(within(dialog()).queryByText('cal.groupCalibration')).toBeNull();
    await click(within(dialog()).getByRole('button', { name: 'eq.attachParent' }));
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('asset.attach.equipment');
  });

  it('the Tree tab shows the whole tree from the root and opens an equipment node in the same modal', async () => {
    await mount();
    await openRow('FIXTURE-01');
    await click(within(dialog()).getByRole('tab', { name: 'eq.tabTree' }));
    await waitFor(() => expect(within(dialog()).getByRole('tree')).toBeTruthy());
    const items = within(dialog()).getAllByRole('treeitem').map((li) => li.textContent);
    expect(items).toEqual(expect.arrayContaining([expect.stringContaining('TESTER-01'), expect.stringContaining('DMM-1'), expect.stringContaining('GB-1')]));
    expect(within(dialog()).getByRole('tree').querySelector('[data-current]')!.textContent).toContain('FIXTURE-01');
    await click(within(dialog()).getByText('TESTER-01'));
    await waitFor(() => expect(title()).toBe('TESTER-01'));
    // Dòng Sub / Golden chuyển sang module của chúng.
    await click(within(dialog()).getByRole('tab', { name: 'eq.tabTree' }));
    await click(await within(dialog()).findByText('DMM-2'));
    expect(push).toHaveBeenCalledWith('/calibration?id=s2');
  });
});

describe('Equipment — add', () => {
  it('Add opens an M modal; the parent cannot be chosen before the part number; saving warns about a duplicate serial first', async () => {
    const matches = [{ asset_type: 'golden_board', id: 'g9', serial_number: 'BASE-NEW', part_number: 'PCBA', location: 'B3F1' }];
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url.startsWith('/api/assets/serial-matches') ? { data: matches, meta: {} } : get(url)));
    vi.mocked(api.post).mockResolvedValue({ data: { ...spare, id: 'e-new', serial_number: 'BASE-NEW' }, meta: {} });
    await mount();
    await click(screen.getAllByRole('button', { name: /eq.add/ })[0]!);
    expect(dialog().classList.contains('modal-dialog--m')).toBe(true);
    expect(currentSearch()).toBe('new=1');
    expect(within(dialog()).getByText('asset.pickPartFirst')).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.serial_number/), { target: { value: 'BASE-NEW' } }); });
    await click(screen.getByLabelText(/fields.part_number/));
    await click(screen.getByRole('option', { name: 'P20001' }));
    await act(async () => { fireEvent.click(screen.getByLabelText(/fields.location/)); });
    await click(screen.getByRole('option', { name: 'B3F1' }));
    // Part number đã chọn: ô cha không còn bị khóa, và Level của part number (EOL) được điền sẵn.
    expect(within(dialog()).queryByText('asset.pickPartFirst')).toBeNull();
    expect(screen.getByLabelText(/fields.level/).textContent).toBe('EOL');
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('asset.serialExists')).toBeTruthy();
    await click(within(footer()).getByRole('button', { name: 'dp.saveAnyway' }));
    expect(api.post).toHaveBeenCalledWith('/api/equipment', expect.objectContaining({ serial_number: 'BASE-NEW', part_number_id: 'pn-b', location_id: 'l1', level_id: 'lv1' }));
    // Lưu xong: modal M đóng, modal L chi tiết của thiết bị vừa tạo mở.
    await waitFor(() => expect(currentSearch()).toBe('id=e-new'));
    expect(dialog().classList.contains('modal-dialog--l')).toBe(true);
  });

  it('Thêm thiết bị con: opens the Add form with the parent fixed and only the part numbers that fit under it', async () => {
    await mount();
    await openRow('TESTER-01');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    await click(screen.getByRole('menuitem', { name: 'eq.addChild' }));
    await waitFor(() => expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toContain('eq.addChildTitle'));
    expect(within(dialog()).getByText(/eq.parentFixed/)).toBeTruthy();
    await click(screen.getByLabelText(/fields.part_number/));
    // Tester ⊃ Base, Fixture (không có Tester, không có sub-equipment).
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['P20001', 'P30005']);
  });
});

describe('Equipment — Type, Level and Location are filled for every device', () => {
  const pick = async (label: RegExp, option: string) => { await click(screen.getByLabelText(label)); await click(screen.getByRole('option', { name: option })); };

  it('without a parent Level is required (like Location): saving without it names the field; Type follows the part number', async () => {
    await mount();
    await click(screen.getAllByRole('button', { name: /eq.add/ })[0]!);
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.serial_number/), { target: { value: 'NEW-1' } }); });
    await pick(/fields.part_number/, 'P12316'); // tester: part number without a Level
    await pick(/fields.location/, 'B3F1');
    expect(within(screen.getByLabelText(/fields.level/).closest('.dp-field') as HTMLElement).getByText('*')).toBeTruthy();
    expect(within(dialog()).getByText('Tester')).toBeTruthy(); // Type from the part number
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/fields.level/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
  });

  it('the Level of the part number is offered when it is chosen and follows a change of part number — a Level picked by hand stays', async () => {
    await mount();
    await click(screen.getAllByRole('button', { name: /eq.add/ })[0]!);
    await pick(/fields.part_number/, 'P20001'); // Level EOL
    expect(screen.getByLabelText(/fields.level/).textContent).toBe('EOL');
    await pick(/fields.part_number/, 'P12316'); // no Level → the offered one goes away
    expect(screen.getByLabelText(/fields.level/).textContent).toBe('dp.selectPlaceholder');
    await pick(/fields.level/, 'EOL'); // chosen by hand
    await pick(/fields.part_number/, 'P30005'); // no Level, but the hand-picked one stays
    expect(screen.getByLabelText(/fields.level/).textContent).toBe('EOL');
  });

  it('a device added under a parent needs neither: Level and Location follow the parent (locked, no asterisk)', async () => {
    await mount();
    await openRow('TESTER-01');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    await click(screen.getByRole('menuitem', { name: 'eq.addChild' }));
    await waitFor(() => expect(within(dialog()).getByText(/eq.parentFixed/)).toBeTruthy());
    await pick(/fields.part_number/, 'P20001');
    expect(within(dialog()).getAllByText('eq.followsFixedParent')).toHaveLength(2); // Location and Level
    expect(within(dialog()).queryByLabelText(/fields.level/)).toBeNull();
  });

  // The locked Level must SHOW the parent's Level (not "—"), the same way the locked Location shows the parent's.
  const levelShown = () => (within(dialog()).getByText('fields.level').closest('.dp-field') as HTMLElement).querySelector('.dp-value')!.textContent;
  const withLevels = (rows: Record<string, { level_id: string; level: string }>) => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const id = url.match(/^\/api\/equipment\/([^/?]+)$/)?.[1];
      return id && rows[id] ? { data: { ...equipmentRows.find((r) => r.id === id), ...rows[id] }, meta: {} } : get(url);
    });
    return () => vi.mocked(api.get).mockImplementation(get);
  };

  it('Thêm thiết bị con: the Level field shows the Level of the fixed parent', async () => {
    const restore = withLevels({ [tester.id]: { level_id: 'lv1', level: 'EOL' } });
    try {
      await mount();
      await openRow('TESTER-01');
      await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
      await click(screen.getByRole('menuitem', { name: 'eq.addChild' }));
      await waitFor(() => expect(within(dialog()).getByText(/eq.parentFixed/)).toBeTruthy());
      await waitFor(() => expect(levelShown()).toBe('EOL'));
      await pick(/fields.part_number/, 'P20001'); // choosing a part number must not change it
      expect(levelShown()).toBe('EOL');
    } finally { restore(); }
  });

  it('a parent chosen in the Add form: the Level field shows that parent\'s Level, and clearing the parent frees it again', async () => {
    const restore = withLevels({ [base.id]: { level_id: 'lv1', level: 'EOL' } });
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url.split('?')[0]!.endsWith('/valid-parents') ? { data: [{
      id: 'e-base', kind: 'base', serial_number: 'BASE-01', part_number: 'P20001', type_name: 'Base', location_id: 'l1', location: 'B3F1', usage: 'in_use', usage_after: 'in_use',
    }], meta: {} } : get(url)));
    try {
      await mount();
      await click(screen.getAllByRole('button', { name: /eq.add/ })[0]!);
      await pick(/fields.part_number/, 'P30005'); // fixture → can sit under a base
      await click(screen.getByLabelText(/fields.parent/));
      await click(await screen.findByRole('option', { name: 'BASE-01 · P20001 · B3F1' }));
      await waitFor(() => expect(levelShown()).toBe('EOL'));
      await pick(/fields.parent/, 'eq.noParent'); // the "no parent" row of the picker clears it
      expect(screen.getByLabelText(/fields.level/)).toBeTruthy(); // Level is a normal required dropdown again
    } finally { restore(); }
  });
});

describe('Equipment — editing', () => {
  it('a device with a parent: Location and Level are locked with the reason; the type is read-only', async () => {
    await mount();
    await openRow('BASE-01');
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    expect(within(dialog()).getByText('eq.locationFromParent')).toBeTruthy();
    expect(within(dialog()).getByText('eq.levelFromParent')).toBeTruthy();
    expect(within(dialog()).getByText('eq.typeFromPartNumber')).toBeTruthy();
    // Chưa đổi gì: Lưu bị khóa.
    expect((within(footer()).getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a Tester has no parent field to fill ("A tester has no parent")', async () => {
    await mount();
    await openRow('TESTER-01');
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    expect(within(dialog()).getByText('asset.testerNoParent')).toBeTruthy();
  });

  it('saving sends only the changed fields and returns to the detail view', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...spare, asset: 'A-1' }, meta: {} });
    await mount();
    await openRow('BASE-02');
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    // BASE-02 has no Level yet (saved before Level became mandatory): it must get one with the next edit.
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.asset/), { target: { value: 'A-1' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.put).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/fields.level/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
    await click(screen.getByLabelText(/fields.level/));
    await click(screen.getByRole('option', { name: 'EOL' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/equipment/e-spare', { asset: 'A-1', level_id: 'lv1' }));
    await waitFor(() => expect(title()).toBe('BASE-02'));
  });
});

