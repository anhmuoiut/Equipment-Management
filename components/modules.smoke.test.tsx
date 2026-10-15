// @vitest-environment jsdom
/**
 * Smoke test các module dùng khung modal (User Management, Configuration, Dashboard) với dữ liệu mẫu: Masterlist hiện dòng,
 * mở modal bản ghi, vào form Sửa, các thao tác Admin — bắt lỗi khi chạy (sai tên trường, crash) mà không cần database.
 * Equipment / Calibration / Golden / Overview có test riêng (components/assets, equipment, calibration, golden, overview).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error('notFound'); },
}));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

const audit = {
  created_at: '2026-10-01T01:00:00Z', created_by: 'u1', created_by_name: 'Admin',
  updated_at: '2026-10-01T02:00:00Z', updated_by: 'u1', updated_by_name: 'Admin',
};
const opt = (id: string, name: string) => ({ id, display_name: name, sort_order: 0, is_active: true });
const options = {
  part_numbers: [
    { ...opt('pn1', 'P12316'), type_id: 't1', kind: 'tester', level_id: 'lv1' },
    { ...opt('pn2', 'DMM-100'), type_id: 't2', kind: 'sub_equipment', level_id: null },
    { ...opt('pn3', 'DMM-200'), type_id: 't2', kind: 'sub_equipment', level_id: null },
  ],
  locations: [opt('l1', 'B3F1'), opt('l2', 'B3F2')],
  types: [{ ...opt('t1', 'Tester'), kind: 'tester', group_id: 'g1' }, { ...opt('t2', 'DMM'), kind: 'sub_equipment', group_id: 'g4' }],
  // Groups: three system Groups (locked), the sub-equipment Group, an Admin Group, and a hidden Admin Group.
  type_groups: [
    { ...opt('g1', 'Tester'), kind: 'tester' }, { ...opt('g2', 'Base'), kind: 'base' }, { ...opt('g3', 'Fixture'), kind: 'fixture' },
    { ...opt('g4', 'Sub-equipment'), kind: 'sub_equipment' }, { ...opt('g5', 'Meters'), kind: 'sub_equipment' },
    { ...opt('g6', 'Retired group'), is_active: false, kind: 'sub_equipment' },
  ],
  levels: [opt('lv1', 'EOL'), opt('lv2', 'ICT')], departments: [opt('d1', 'TE')], calibration_vendors: [opt('v1', 'Internal')],
  tags: [
    { id: 'tg1', display_name: 'Repair', sort_order: 1, color: 'yellow' },
    { id: 'tg2', display_name: 'Spare', sort_order: 2, color: 'gray' },
  ],
};
const users = [
  {
    id: 'u1', username: 'admin', full_name: 'Ann Admin', employee_id: '1', department_id: 'd1', department: 'TE', role: 'admin',
    is_active: true, must_change_password: false, ...audit,
  },
  {
    id: 'u2', username: 'bob', full_name: 'Bob', employee_id: '100', department_id: 'd1', department: 'TE', role: 'readonly',
    is_active: true, must_change_password: true, ...audit,
  },
  {
    id: 'u3', username: 'cat', full_name: 'Cat', employee_id: null, department_id: null, department: null, role: 'user',
    is_active: false, must_change_password: false, ...audit,
  },
];
const config = {
  'part-numbers': [{ id: 'pn1', display_name: 'P12316', type_id: 't1', type: 'Tester', level_id: 'lv1', level: 'EOL', sort_order: 0, is_active: true, ...audit }],
  types: [
    { id: 't1', display_name: 'Tester', kind: 'tester', group_id: 'g1', group: 'Tester', description: null, sort_order: 0, is_active: true, ...audit },
    { id: 't2', display_name: 'DMM', kind: 'sub_equipment', group_id: 'g4', group: 'Sub-equipment', description: null, sort_order: 1, is_active: true, ...audit },
  ],
  'type-groups': [
    { id: 'g1', display_name: 'Tester', kind: 'tester', sort_order: 1, is_active: true, ...audit },
    { id: 'g4', display_name: 'Sub-equipment', kind: 'sub_equipment', sort_order: 4, is_active: true, ...audit },
    { id: 'g5', display_name: 'Meters', kind: 'sub_equipment', sort_order: 5, is_active: true, ...audit },
  ],
  tags: [{ id: 'tg1', display_name: 'Repair', sort_order: 1, is_active: true, color: 'purple', ...audit }],
  'calibration-setup': [{ id: 'cc1', display_name: 'DMM-100', sort_order: 0, is_active: true, part_number_id: 'pn2', interval_months: 12, warning_days: 30, ...audit }],
};
const errorLog = [{ id: 'x1', request_id: 'req_1', route: 'GET /api/x', user_id: null, user_name: null, error_code: 'SERVER_ERROR', message: 'boom', stack: 'at x', created_at: audit.created_at }];

function respond(url: string): unknown {
  const path = url.split('?')[0]!;
  if (path === '/api/options') return options;
  if (path === '/api/users') return users;
  const one = path.match(/^\/api\/users\/([^/]+)$/);
  if (one) return users.find((u) => u.id === one[1]);
  if (path.endsWith('/history')) return [{ id: 'h1', label: 'bob', action: 'PASSWORD_RESET', changes: { must_change_password: { old: false, new: true } },
    note: null, source: 'ui', created_at: audit.created_at, created_by: 'u1', created_by_name: 'Admin' }];
  if (path === '/api/configuration/error-log') return errorLog;
  const cfgOne = path.match(/^\/api\/configuration\/([^/]+)\/([^/]+)$/);
  if (cfgOne) return (config[cfgOne[1] as keyof typeof config] ?? []).find((r) => r.id === cfgOne[2]);
  const cfg = path.match(/^\/api\/configuration\/([^/]+)$/);
  if (cfg) return config[cfg[1] as keyof typeof config] ?? [];
  throw new Error('unexpected GET ' + url);
}
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async (url: string) => ({ data: respond(url), meta: {} })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/client/api';
import { resetUrl } from '@/lib/client/testing/urlParamsMock';
import { ViewerProvider } from '@/components/ViewerContext';
import { UsersWorkspace } from '@/components/users/UsersWorkspace';
import { ConfigWorkspace } from '@/components/configuration/ConfigWorkspace';
import { ErrorLogWorkspace } from '@/components/configuration/ErrorLogWorkspace';
import { Dashboard } from '@/components/dashboard/Dashboard';
import type { Role } from '@/lib/permissions';

beforeEach(() => { resetUrl(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); });

async function mount(node: ReactNode, role: Role = 'admin') {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann Admin', role }}>{node}</ViewerProvider>);
  });
}
const dialog = () => screen.getByRole('dialog');
const footer = () => dialog().querySelector('.modal-footer') as HTMLElement;
/** Bấm dòng đầu tiên có chữ này (chữ có thể lặp ở dòng khác) → modal bản ghi mở và đã tải xong. */
async function openRow(text: string) {
  await act(async () => { fireEvent.click(screen.getAllByText(text, { selector: 'td *, td' })[0]!); });
  expect(within(dialog()).getByRole('heading', { level: 2 })).toBeTruthy();
}
async function openActions() {
  await act(async () => { fireEvent.click(within(footer()).getByRole('button', { name: /dp.actionsMenu/ })); });
}
async function clickEdit() {
  await act(async () => { fireEvent.click(within(footer()).getByRole('button', { name: /common.edit/ })); });
  expect(within(footer()).getByRole('button', { name: 'common.save' })).toBeTruthy();
}
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

describe('User Management — Admin tạo tài khoản, bốn thao tác', () => {
  it('lists accounts with status and "must change password"; the locked filter counts locked accounts; no approve / email / account type', async () => {
    await mount(<UsersWorkspace />);
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /fields.account_status/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /fields.must_change_password/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /fields.email|fields.auth_provider|fields.approved_by/ })).toBeNull();
    expect(screen.getByRole('button', { name: /usr.lockedFilter/ })).toBeTruthy();
    expect(screen.getAllByText('values.locked').length).toBeGreaterThan(0);
  });

  it('another account offers Reset password and Lock in the actions menu; an admin cannot lock or reset themself', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await openActions();
    expect(screen.getByRole('menuitem', { name: /usr.resetPassword/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /usr.disable/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /usr.approve|usr.reject/ })).toBeNull();
  });

  it('own row: no Reset password / Lock', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Ann Admin');
    // Không còn thao tác nào dành cho chính mình → không có menu Thao tác, chỉ còn Sửa.
    expect(within(footer()).queryByRole('button', { name: /dp.actionsMenu/ })).toBeNull();
    expect(within(footer()).getByRole('button', { name: /common.edit/ })).toBeTruthy();
  });

  it('a locked account can be unlocked', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Cat');
    await openActions();
    expect(screen.getByRole('menuitem', { name: /usr.enable/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /usr.disable/ })).toBeNull();
  });

  it('Reset password asks for confirmation, then shows the temporary password once with a Copy button', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { user: users[1], temp_password: 'Jabil-4827' }, meta: {} });
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await openActions();
    await click(screen.getByRole('menuitem', { name: /usr.resetPassword/ }));
    // Breadcrumb ← Bob › usr.resetPassword; nút chính ở footer.
    await click(within(footer()).getByRole('button', { name: 'usr.resetPassword' }));
    expect(api.post).toHaveBeenCalledWith('/api/users/u2/password');
    expect(screen.getByTestId('temp-password').textContent).toBe('Jabil-4827');
    expect(within(footer()).getByRole('button', { name: /usr.temp.copy/ })).toBeTruthy();
  });

  it('closing the temporary password without copying asks first (inside the same modal); copying lets it close', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { user: users[1], temp_password: 'Jabil-1111' }, meta: {} });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await openActions();
    await click(screen.getByRole('menuitem', { name: /usr.resetPassword/ }));
    await click(within(footer()).getByRole('button', { name: 'usr.resetPassword' }));

    await click(within(footer()).getByRole('button', { name: 'usr.temp.done' }));
    expect(screen.getByText('usr.temp.closeTitle')).toBeTruthy(); // hỏi lại, chưa đóng
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // cùng một modal, không hộp thoại thứ hai
    await click(screen.getByRole('button', { name: 'usr.temp.stay' }));
    expect(screen.queryByText('usr.temp.closeTitle')).toBeNull();
    await click(within(footer()).getByRole('button', { name: /usr.temp.copy/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Jabil-1111');
    await click(within(footer()).getByRole('button', { name: 'usr.temp.done' }));
    expect(screen.queryByTestId('temp-password')).toBeNull();
    expect(screen.queryByText('usr.temp.closeTitle')).toBeNull();
  });

  it('Add: no password field and no email; saving shows the temporary password the server generated, then opens the new account', async () => {
    const created = { ...users[1], id: 'u9', username: 'dan', full_name: 'Dan' };
    vi.mocked(api.post).mockResolvedValue({ data: { user: created, temp_password: 'Jabil-2222' }, meta: {} });
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url: string) => (url === '/api/users/u9' ? { data: created, meta: {} } : get(url)));
    await mount(<UsersWorkspace />);
    await click(screen.getAllByRole('button', { name: /usr.add/ })[0]!);
    expect(screen.queryByLabelText(/usr.initialPassword|fields.email/)).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.username/), { target: { value: 'dan' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.full_name/), { target: { value: 'Dan' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).toHaveBeenCalledWith('/api/users', expect.objectContaining({ username: 'dan', full_name: 'Dan', role: 'readonly' }));
    expect(screen.getByTestId('temp-password').textContent).toBe('Jabil-2222');

    await click(within(footer()).getByRole('button', { name: /usr.temp.copy/ }));
    await click(within(footer()).getByRole('button', { name: 'usr.temp.done' }));
    // Modal M đóng, chi tiết tài khoản vừa tạo mở trong modal mới.
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Dan');
  });

  it('Edit: the username is locked — shown as a plain value, with no input', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await clickEdit();
    expect(document.getElementById('f-username')).toBeNull();
    expect(within(dialog()).getAllByText('bob').length).toBeGreaterThan(0);
  });

  it('Edit with an unsaved change: Esc asks "discard?" inside the modal; Stay keeps the form, Discard closes the modal', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await clickEdit();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.full_name/), { target: { value: 'Bobby' } }); });
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.getByText('dp.discardTitle')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // Esc trên màn hình đó = Ở lại.
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByText('dp.discardTitle')).toBeNull();
    expect((screen.getByLabelText(/fields.full_name/) as HTMLInputElement).value).toBe('Bobby');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    await click(screen.getByRole('button', { name: 'dp.discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('the ← in the breadcrumb leaves the form for the detail view (asking first when there are unsaved changes)', async () => {
    await mount(<UsersWorkspace />);
    await openRow('Bob');
    await clickEdit();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.full_name/), { target: { value: 'Bobby' } }); });
    await click(within(dialog()).getByRole('button', { name: 'dp.back' }));
    expect(screen.getByText('dp.discardTitle')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'dp.discard' }));
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Bob');
    expect(within(footer()).getByRole('button', { name: /common.edit/ })).toBeTruthy();
  });
});

describe('Configuration', () => {
  it.each(['part-numbers', 'tags', 'calibration-setup', 'types'] as const)('%s: list → modal → edit', async (list) => {
    await mount(<ConfigWorkspace listKey={list} />);
    await openRow(list === 'tags' ? 'Repair' : list === 'calibration-setup' ? 'DMM-100' : list === 'types' ? 'DMM' : 'P12316');
    await clickEdit();
    // Setup hiệu chuẩn: part number khóa khi sửa (đổi PN = xóa rồi thêm lại) — chỉ hiện giá trị, không có ô chọn.
    if (list === 'calibration-setup') expect(screen.queryByLabelText(/fields.part_number/)).toBeNull();
  });

  it('a Configuration record has no History tab and nothing asks the server for one (changes to the lists are not recorded)', async () => {
    await mount(<ConfigWorkspace listKey="tags" />);
    await openRow('Repair');
    expect(within(dialog()).getByRole('heading', { level: 2 }).textContent).toBe('Repair');
    expect(screen.queryByRole('tab', { name: 'dp.tabHistory' })).toBeNull();
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).endsWith('/history'))).toBe(false);
  });

  it('part numbers: the Manufacturer column is there — also for someone whose saved column choices were made before it existed', async () => {
    localStorage.setItem('masterlist-columns:configuration-part-numbers', JSON.stringify({ order: ['display_name', 'type', 'level', 'sort_order', 'is_active'], hidden: ['sort_order'] }));
    await mount(<ConfigWorkspace listKey="part-numbers" />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => /fields.manufacturer/.test(h))).toBe(true);
    expect(headers.some((h) => /fields.sort_order/.test(h))).toBe(false); // their own choice is kept
    localStorage.clear();
  });

  it('part numbers: the Add form and the record both have the Manufacturer field', async () => {
    await mount(<ConfigWorkspace listKey="part-numbers" />);
    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    expect(screen.getByLabelText(/fields.manufacturer/)).toBeTruthy();
    await click(within(footer()).getByRole('button', { name: 'common.cancel' }));
  });

  it('part numbers: Type column and required Type, and no "needs a parent" setting any more', async () => {
    await mount(<ConfigWorkspace listKey="part-numbers" />);
    expect(screen.getByRole('columnheader', { name: /fields.type/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /usage_needs_parent/ })).toBeNull();
    expect(screen.getAllByText('Tester').length).toBeGreaterThan(0);

    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    expect(screen.queryByText(/usageNeedsParent/)).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.display_name/), { target: { value: 'P99999' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/fields.type/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
  });

  it('types: shows the Group by name; the three system Types cannot be hidden, Admin-added Types can', async () => {
    await mount(<ConfigWorkspace listKey="types" />);
    expect(screen.getByRole('columnheader', { name: /fields.group/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /fields.kind/ })).toBeNull();
    expect(screen.getAllByText('Tester').length).toBeGreaterThan(1); // Type và Group cùng tên
    expect(screen.getByText('Sub-equipment')).toBeTruthy();

    await openRow('Tester');
    // Loại hệ thống: không có thao tác Ẩn → không có menu Thao tác.
    expect(within(footer()).queryByRole('button', { name: /dp.actionsMenu/ })).toBeNull();
    // Đóng modal (✕) rồi mở dòng DMM.
    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openRow('DMM');
    await openActions();
    expect(screen.getByRole('menuitem', { name: /cfg.hide/ })).toBeTruthy();
  });

  it('types: the Group of a system Type is fixed; an Admin Type picks from the sub-equipment Groups in use (never a system Group)', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...config.types[1]!, group_id: 'g5', group: 'Meters' }, meta: {} });
    await mount(<ConfigWorkspace listKey="types" />);
    await openRow('Tester');
    await clickEdit();
    expect(screen.queryByLabelText(/fields.group/)).toBeNull();
    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });

    await openRow('DMM');
    await clickEdit();
    await click(screen.getByLabelText(/fields.group/));
    // Sub-equipment và Meters; không có Tester / Base / Fixture (nhóm hệ thống) và không có nhóm đã ẩn.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Sub-equipment', 'Meters']);
    await click(screen.getByRole('option', { name: 'Meters' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.put).toHaveBeenCalledWith('/api/configuration/types/t2', { group_id: 'g5' });
  });

  it('types: Group is required when adding a Type; the kind is not asked (it follows the Group)', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { ...config.types[1]!, id: 't9', display_name: 'Scope', group_id: 'g5', group: 'Meters' }, meta: {} });
    await mount(<ConfigWorkspace listKey="types" />);
    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    expect(screen.queryByLabelText(/fields.kind/)).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.display_name/), { target: { value: 'Scope' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/fields.group/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
    await click(screen.getByLabelText(/fields.group/));
    await click(screen.getByRole('option', { name: 'Meters' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).toHaveBeenCalledWith('/api/configuration/types', expect.objectContaining({ display_name: 'Scope', group_id: 'g5' }));
  });

  it('groups: a plain list; the system Groups cannot be hidden, an Admin Group can; Admin can add one', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { ...config['type-groups'][2]!, id: 'g9', display_name: 'Probes' }, meta: {} });
    await mount(<ConfigWorkspace listKey="type-groups" />);
    expect(screen.getByRole('columnheader', { name: /fields.display_name/ })).toBeTruthy();
    expect(screen.getByText('Meters')).toBeTruthy();
    await openRow('Tester');
    await clickEdit();
    expect(document.getElementById('f-is_active')).toBeNull(); // a system Group cannot be hidden: no switch
    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    await openRow('Meters');
    await openActions();
    expect(screen.getByRole('menuitem', { name: /cfg.hide/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /common.delete/ })).toBeNull(); // nhóm chỉ ẩn, không xóa
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    await click(within(dialog()).getByRole('button', { name: 'common.close' }));

    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.display_name/), { target: { value: 'Probes' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).toHaveBeenCalledWith('/api/configuration/type-groups', { display_name: 'Probes', sort_order: 0, is_active: true });
  });

  it('part numbers: a Level column; Level is a dropdown of the Level master data and is optional', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...config['part-numbers'][0]!, level_id: 'lv2', level: 'ICT' }, meta: {} });
    vi.mocked(api.post).mockResolvedValue({ data: { ...config['part-numbers'][0]!, id: 'pn9', display_name: 'P99999' }, meta: {} });
    await mount(<ConfigWorkspace listKey="part-numbers" />);
    expect(screen.getByRole('columnheader', { name: /fields.level/ })).toBeTruthy();
    expect(screen.getByText('EOL')).toBeTruthy();
    await openRow('P12316');
    await clickEdit();
    await click(screen.getByLabelText(/fields.level/));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['dp.selectPlaceholder', 'EOL', 'ICT']); // có dòng bỏ chọn
    await click(screen.getByRole('option', { name: 'ICT' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.put).toHaveBeenCalledWith('/api/configuration/part-numbers/pn1', { level_id: 'lv2' });

    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    expect(within(screen.getByLabelText(/fields.level/).closest('.dp-field') as HTMLElement).queryByText('*')).toBeNull(); // không có dấu * bắt buộc
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.display_name/), { target: { value: 'P99999' } }); });
    await click(screen.getByLabelText(/fields.type/));
    await click(screen.getByRole('option', { name: 'Tester' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).toHaveBeenCalledWith('/api/configuration/part-numbers', expect.not.objectContaining({ level_id: expect.anything() }));
  });

  it('calibration setup: only sub-equipment part numbers that are not set up yet can be chosen', async () => {
    await mount(<ConfigWorkspace listKey="calibration-setup" />);
    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    await click(screen.getByLabelText(/fields.part_number/));
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['DMM-200']); // DMM-100 đã có Setup; P12316 là part number của tester
  });

  it('tags: pastel color chip in list; six palettes, required when adding', async () => {
    await mount(<ConfigWorkspace listKey="tags" />);
    expect(document.querySelector('td .tag-status[data-manual-color="purple"]')?.textContent).toBe('cfg.tagPalette.purple');
    await openRow('Repair');
    await clickEdit();
    const picker = screen.getByRole('radiogroup', { name: 'fields.color' });
    expect(within(picker).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['blue', 'green', 'gray', 'purple', 'yellow', 'red']);
    expect((within(picker).getByRole('radio', { checked: true }) as HTMLInputElement).value).toBe('purple');

    await click(within(dialog()).getByRole('button', { name: 'common.close' }));
    await click(screen.getAllByRole('button', { name: /ml.add/ })[0]!);
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.display_name/), { target: { value: 'Scrap' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(screen.getByRole('radiogroup', { name: 'fields.color' }).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
  });

  it.each(['yellow', 'red'] as const)('tags: an admin can save the new %s color', async (color) => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...config.tags[0], color }, meta: {} });
    await mount(<ConfigWorkspace listKey="tags" />);
    await openRow('Repair');
    await clickEdit();
    await click(screen.getByRole('radio', { name: `cfg.tagPalette.${color}` }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.put).toHaveBeenCalledWith('/api/configuration/tags/tg1', expect.objectContaining({ color }));
    expect(within(dialog()).getAllByText('Repair').some((e) => e.getAttribute('data-manual-color') === color)).toBe(true);
  });

  it('Error log: read-only modal', async () => {
    await mount(<ErrorLogWorkspace />);
    await act(async () => { fireEvent.click(screen.getByText('req_1')); });
    expect(screen.getByText('at x')).toBeTruthy();
    expect(within(footer()).getByRole('button', { name: 'common.close' })).toBeTruthy();
  });
});

describe('Dashboard', () => {
  it('Dashboard renders KPIs, Status bars per asset kind + Calibration Status, due lists and recent changes', async () => {
    const alert = {
      id: 's1', serial_number: 'DMM-1', part_number: 'DMM-100', type: 'DMM', tester_serial: 'TESTER-01', location: 'B3F1',
      due_date: '2026-09-30', status: 'overdue',
    };
    const base = { created_at: audit.created_at, created_by: 'u1', created_by_name: 'Admin', item_count: 1 };
    // Recent changes: ONE row per user action (records = the affected records of that action).
    const activities = [
      { ...base, id: 'a1', module: 'equipment', modules: ['equipment'], action: 'UPDATE', source: 'ui',
        records: [{ module: 'equipment', object_id: 'e1', label: 'SN-ROOT', action: 'UPDATE', changes: { asset: { old: null, new: 'A1' } }, note: null }] },
      { ...base, id: 'a2', module: 'golden_board', modules: ['golden_board'], action: 'CREATE', source: 'import', item_count: 40,
        records: [{ module: 'golden_board', object_id: 'g1', label: 'G-1', action: 'CREATE', changes: {}, note: null }] },
    ];
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/api/dashboard') {
        const usage = (inUse: number, notInUse: number) => [
          { id: 'in_use', label: null, count: inUse, color: 'green' }, { id: 'not_in_use', label: null, count: notInUse, color: 'gray' },
        ];
        return { data: {
          equipment_total: 2, sub_equipment_total: 3, golden_total: 1,
          by_usage: { equipment: usage(1, 1), sub_equipment: usage(2, 1), golden_board: usage(0, 1) },
          by_calibration_status: [
            { id: 'not_calibrated', label: null, count: 1, color: 'gray' }, { id: 'failed', label: null, count: 0, color: 'red' },
            { id: 'overdue', label: null, count: 1, color: 'red' }, { id: 'due_soon', label: null, count: 0, color: 'yellow' },
            { id: 'valid', label: null, count: 1, color: 'green' },
          ],
          by_tag: [{ id: 'tg1', label: 'Repair', count: 2 }], by_location: [{ id: 'l1', label: 'B3F1', count: 4 }], by_type: [],
          overdue: [alert], due_soon: [],
          // the first page of Recent changes now arrives with the summary (one request); filters still call /activities
          activities,
        }, meta: {} };
      }
      if (url.startsWith('/api/dashboard/activities')) return { data: activities, meta: {} };
      return { data: respond(url), meta: {} };
    });
    await mount(<Dashboard />);
    expect(screen.getByText('dash.overdueTitle')).toBeTruthy();
    expect(screen.getByText('dash.byStatus')).toBeTruthy();
    // Bốn khối Status: Equipment, Sub-equipment, Golden board (In use / Not in use) và Calibration Status.
    expect(screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'))).toEqual(['dash.statusOf', 'dash.statusOf', 'dash.statusOf', 'dash.statusOf']);
    expect(document.querySelectorAll('.dash-stack-seg[data-status-color="red"]').length).toBe(2);
    expect(screen.getByText('cal.status.not_calibrated')).toBeTruthy();
    expect(screen.getAllByText('cal.status.overdue').length).toBeGreaterThan(0);
    expect(screen.getByText('DMM-1')).toBeTruthy();
    expect(screen.getByText('dash.byTag')).toBeTruthy();
    expect(screen.queryByText('dash.pendingUsers')).toBeNull();
    // One user action = one sentence; the record name is a link; an import is ONE line whose records stay behind "Show more".
    expect(screen.getByText('hist.act.updated')).toBeTruthy();
    expect(screen.getByText('hist.act.importedGolden')).toBeTruthy();
    expect(screen.queryByText('G-1')).toBeNull();
  });
});
