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

import { base, equipment, equipmentRows, options, spare, tester, treeResponse } from '@/lib/client/testing/assetFixtures';
import { pagedResponse } from '@/lib/client/testing/pagedServer';

/** The rows the (fake) server pages through: the four of the fixture tree, or a big list when a test needs several pages. */
let listRows = equipmentRows;
const listUsage = (url: string) => new URL(url, 'http://x').searchParams.get('f.usage');

function respond(url: string): { data: unknown; meta?: Record<string, unknown> } {
  const [path] = url.split('?');
  if (path === '/api/options') return { data: options };
  if (path === '/api/equipment') {
    return pagedResponse(listRows, url, {
      filters: { usage: (r, v) => r.usage === v }, sort: { serial_number: (r) => r.serial_number },
      search: (r, q) => [r.serial_number, r.part_number, r.location].some((v) => v?.toLowerCase().includes(q)),
    });
  }
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
import { listCache, pagedCache } from '@/lib/client/cache';
import { resetUrl, currentSearch, historyDepth } from '@/lib/client/testing/urlParamsMock';
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
/** The relation list shows its first row only; open every "show N more" toggle so all rows are reachable. */
const expandRelations = async () => {
  await waitFor(() => expect(within(dialog()).queryAllByRole('button', { name: /asset.showMoreRelations/ }).length).toBeGreaterThan(0));
  for (const toggle of within(dialog()).queryAllByRole('button', { name: /asset.showMoreRelations/ })) await click(toggle);
};
/** "Thêm thiết bị con" form is open (the parent is fixed: it is shown as a value, not an editor). */
const childFormReady = () => waitFor(() => expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toContain('eq.addChildTitle'));

const phone = (matches: boolean) => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
};

beforeEach(() => { listRows = equipmentRows; pagedCache.clear(); listCache.clear(); resetUrl(); phone(false); push.mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); });

describe('Equipment — masterlist', () => {
  it('shows the parent/child column, Status first, and the default columns', async () => {
    await mount();
    expect(screen.getByText('TESTER-01')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => /fields.usage/.test(h))).toBe(true);
    expect(headers.some((h) => /fields.serial_number/.test(h))).toBe(true);
    expect(headers.some((h) => /fields.remark/.test(h))).toBe(false); // cột phụ ẩn mặc định
    expect(document.querySelectorAll('.rel').length).toBe(3); // tester (có con), base (có con), fixture (có con) — spare không có gì
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

  it('clicking the parent chip changes the desktop selection inside the same modal without adding a breadcrumb', async () => {
    await mount();
    await openRow('BASE-01');
    await click(within(dialog()).getByRole('button', { name: /TESTER-01/ }));
    await waitFor(() => expect(title()).toBe('TESTER-01'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(currentSearch()).toBe('id=e-tester');
    expect(dialog().querySelectorAll('.rm-crumbwrap')).toHaveLength(0);
    expect(historyDepth()).toBe(1);
  });

  it('phone relation navigation keeps the breadcrumb and can return to the original equipment', async () => {
    phone(true);
    resetUrl('id=e-base');
    await mount();
    await click(within(dialog()).getByRole('button', { name: /TESTER-01/ }));
    await waitFor(() => expect(title()).toBe('TESTER-01'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialog().querySelectorAll('.rm-crumbwrap')).toHaveLength(1);
    expect(within(dialog()).getByRole('button', { name: 'BASE-01' })).toBeTruthy();
    await click(within(dialog()).getByRole('button', { name: 'dp.back' }));
    await waitFor(() => expect(title()).toBe('BASE-01'));
    expect(currentSearch()).toBe('id=e-base');
    expect(dialog().querySelectorAll('.rm-crumbwrap')).toHaveLength(0);
  });

  it('a Tester lists its sub-equipment (with Calibration Status); clicking one goes to that module with ?id=', async () => {
    await mount();
    await openRow('TESTER-01');
    await expandRelations();
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
    // Each sub-equipment is a "SN · Type" chip.
    expect(within(dialog()).getByRole('button', { name: /^DMM-1/ })).toBeTruthy();
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
      await expandRelations();
      await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
      expect(within(dialog()).queryByRole('button', { name: 'common.retry' })).toBeNull();
    } finally {
      vi.mocked(api.get).mockImplementation(get);
    }
  });

  it('the children, Calibration summary and desktop tree pane share ONE tree request per record', async () => {
    vi.mocked(api.get).mockClear();
    await mount();
    await openRow('TESTER-01');
    await expandRelations();
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /DMM-2/ })).toBeTruthy());
    expect(within(dialog()).queryByRole('tab', { name: 'eq.tabTree' })).toBeNull();
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

  it('the desktop tree pane shows the whole tree and opens an equipment node in the same modal', async () => {
    await mount();
    await openRow('FIXTURE-01');
    expect(within(dialog()).queryByRole('tab', { name: 'eq.tabTree' })).toBeNull();
    await waitFor(() => expect(within(dialog()).getByRole('tree')).toBeTruthy());
    const items = within(dialog()).getAllByRole('treeitem').map((li) => li.textContent);
    expect(items).toEqual(expect.arrayContaining([expect.stringContaining('TESTER-01'), expect.stringContaining('DMM-1'), expect.stringContaining('GB-1')]));
    expect(within(dialog()).getByRole('tree').querySelector('[data-current]')!.textContent).toContain('FIXTURE-01');
    const initialDialog = dialog();
    for (const [serial, id] of [
      ['TESTER-01', 'e-tester'], ['BASE-01', 'e-base'], ['FIXTURE-01', 'e-fixture'],
      ['TESTER-01', 'e-tester'], ['FIXTURE-01', 'e-fixture'], ['BASE-01', 'e-base'], ['TESTER-01', 'e-tester'],
    ]) {
      await click(await within(within(dialog()).getByRole('tree')).findByText(serial!));
      await waitFor(() => expect(title()).toBe(serial));
      expect(screen.getAllByRole('dialog')).toEqual([initialDialog]);
      expect(dialog().querySelectorAll('.rm-crumbwrap')).toHaveLength(0);
      expect(currentSearch()).toBe(`id=${id}`);
      expect(historyDepth()).toBe(1);
      expect(within(dialog()).getByRole('tree').querySelector('[data-current]')!.textContent).toContain(serial);
    }
    // Dòng Sub / Golden chuyển sang module của chúng.
    expect(within(dialog()).queryByRole('tab', { name: 'eq.tabTree' })).toBeNull();
    await click(await within(within(dialog()).getByRole('tree')).findByText('DMM-2'));
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
    expect(within(dialog()).queryAllByLabelText(/fields.parent/)).toHaveLength(0); // locked (value only) until a part number is chosen
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.serial_number/), { target: { value: 'BASE-NEW' } }); });
    await click(screen.getByLabelText(/fields.part_number/));
    await click(screen.getByRole('option', { name: 'P20001' }));
    await act(async () => { fireEvent.click(screen.getByLabelText(/fields.location/)); });
    await click(screen.getByRole('option', { name: 'B3F1' }));
    // Part number đã chọn: ô cha không còn bị khóa, và Level của part number (EOL) được điền sẵn.
    expect(within(dialog()).queryAllByLabelText(/fields.parent/).length).toBeGreaterThan(0);
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
    await childFormReady();
    expect(within(dialog()).queryAllByLabelText(/fields.parent/)).toHaveLength(0); // fixed: a value, not an editor
    expect(within(dialog()).getAllByText('TESTER-01').length).toBeGreaterThan(0);
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
    await childFormReady();
    await pick(/fields.part_number/, 'P20001');
    expect(within(dialog()).queryByLabelText(/fields.location/)).toBeNull(); // locked: follows the parent
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
      await childFormReady();
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
  it('a device with a parent: Location and Level are locked; the type is read-only', async () => {
    await mount();
    await openRow('BASE-01');
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    // Locked fields are shown as plain values (no editor); the reason is not rendered.
    expect(within(dialog()).queryByLabelText(/fields.location/)).toBeNull();
    expect(within(dialog()).queryByLabelText(/fields.level/)).toBeNull();
    expect(within(dialog()).queryByLabelText(/fields.type/)).toBeNull();
    // Chưa đổi gì: Lưu bị khóa.
    expect((within(footer()).getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a Tester has no parent field to fill ("A tester has no parent")', async () => {
    await mount();
    await openRow('TESTER-01');
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    expect(within(dialog()).queryAllByLabelText(/fields.parent/)).toHaveLength(0); // a Tester has no parent: a value, not an editor
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

/** Requests for the LIST (not a record, tree or history). */
const listCalls = () => vi.mocked(api.get).mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/equipment?'));
const big = Array.from({ length: 130 }, (_, i) => equipment({ id: `e${i}`, serial_number: `SN-${String(i).padStart(3, '0')}`, usage: i % 2 ? 'in_use' : 'not_in_use' }));

describe('Equipment — paged list', () => {
  it('opens with ONE request for the first 50 rows of a 130-row table — not the whole table', async () => {
    listRows = big;
    vi.mocked(api.get).mockClear();
    await mount();
    expect(listCalls()).toEqual(['/api/equipment?page=1&pageSize=50']);
    expect(document.querySelectorAll('.ml-table tbody tr[data-row-id]')).toHaveLength(50);
    expect(screen.getByText('ml.count{"count":50,"total":130}')).toBeTruthy(); // 50 shown of 130 matching
  });

  it('Next asks only for the next page; Previous goes back from memory (no new request)', async () => {
    listRows = big;
    vi.mocked(api.get).mockClear();
    await mount();
    await click(screen.getByRole('button', { name: 'ml.nextPage' }));
    await waitFor(() => expect(screen.getByText('SN-050')).toBeTruthy());
    expect(listCalls()).toEqual(['/api/equipment?page=1&pageSize=50', '/api/equipment?page=2&pageSize=50']);
    expect(screen.getAllByRole('cell').some((c) => c.textContent === '51')).toBe(true); // the No column continues
    await click(screen.getByRole('button', { name: 'ml.prevPage' }));
    await waitFor(() => expect(screen.getByText('SN-000')).toBeTruthy());
    expect(listCalls()).toHaveLength(2);
  });

  it('searching finds a row that is NOT on the page on screen — one request after the typing stops', async () => {
    listRows = big;
    vi.mocked(api.get).mockClear();
    await mount();
    expect(screen.queryByText('SN-120')).toBeNull(); // on page 3
    const box = screen.getByRole('searchbox');
    for (const text of ['S', 'SN', 'SN-', 'SN-1', 'SN-12', 'SN-120']) await act(async () => { fireEvent.change(box, { target: { value: text } }); });
    await waitFor(() => expect(screen.getByText('SN-120')).toBeTruthy(), { timeout: 3000 });
    expect(listCalls().filter((u) => u.includes('q='))).toEqual(['/api/equipment?page=1&pageSize=50&q=SN-120']); // not one per key
  });

  it('a filter and a sort are server queries over the whole table, and the page goes back to 1', async () => {
    listRows = big;
    vi.mocked(api.get).mockClear();
    await mount();
    await click(screen.getByRole('button', { name: 'ml.nextPage' }));
    await waitFor(() => expect(screen.getByText('SN-050')).toBeTruthy());
    await click(screen.getByRole('button', { name: /fields.serial_number/ }));
    await waitFor(() => expect(listCalls().at(-1)).toBe('/api/equipment?page=1&pageSize=50&sort=serial_number&dir=asc'));
    expect(listUsage(listCalls().at(-1)!)).toBeNull();
    await click(screen.getByRole('button', { name: /ml.filters/ }));
    await click(screen.getByLabelText('fields.usage'));
    await click(screen.getByRole('option', { name: 'values.in_use' }));
    await waitFor(() => expect(listCalls().at(-1)).toBe('/api/equipment?page=1&pageSize=50&sort=serial_number&dir=asc&f.usage=in_use'));
    await waitFor(() => expect(screen.getByText('ml.count{"count":50,"total":65}')).toBeTruthy()); // 65 of the 130 are In use
  });

  it('opening and closing a record does not ask for the list again', async () => {
    vi.mocked(api.get).mockClear();
    await mount();
    const before = listCalls().length;
    await openRow('BASE-02');
    await click(dialog().querySelector('.modal-close') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openRow('TESTER-01');
    expect(listCalls()).toHaveLength(before);
  });

  it('saving a record refreshes the page that is on screen once — nothing else of the list', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...spare, asset: 'A-1', level_id: 'lv1', level: 'EOL' }, meta: {} });
    vi.mocked(api.get).mockClear();
    await mount();
    await openRow('BASE-02');
    const before = listCalls().length;
    await click(within(footer()).getByRole('button', { name: 'common.edit' }));
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.asset/), { target: { value: 'A-1' } }); });
    await click(screen.getByLabelText(/fields.level/));
    await click(screen.getByRole('option', { name: 'EOL' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    await waitFor(() => expect(listCalls()).toHaveLength(before + 1));
    expect(listCalls().at(-1)).toBe('/api/equipment?page=1&pageSize=50');
  });

  it('an empty table says so (and offers the first record) instead of an empty page', async () => {
    listRows = [];
    await mount();
    await waitFor(() => expect(screen.getByText('ml.emptyTitle')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'ml.pagination' })).toBeNull();
  });
});
