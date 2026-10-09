// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/golden', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

import { goldenRows, options } from '@/lib/client/testing/assetFixtures';

function respond(url: string): { data: unknown; meta?: Record<string, unknown> } {
  const [path] = url.split('?');
  if (path === '/api/options') return { data: options };
  if (path === '/api/golden') return { data: goldenRows };
  const one = path!.match(/^\/api\/golden\/([^/]+)$/);
  if (one) return { data: goldenRows.find((r) => r.id === one[1]) };
  if (path!.endsWith('/history')) return { data: [] };
  if (path === '/api/assets/serial-matches') return { data: [] };
  if (path!.endsWith('/valid-parents')) return { data: [{ id: 'e-fixture', kind: 'fixture', serial_number: 'FIXTURE-01', part_number: 'P30005', type_name: 'Fixture', location_id: 'l1', location: 'B3F1', usage: 'in_use', usage_after: 'in_use' }] };
  throw new Error('unexpected GET ' + url);
}
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async (url: string) => ({ meta: {}, ...respond(url) })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/client/api';
import { resetUrl } from '@/lib/client/testing/urlParamsMock';
import { ViewerProvider } from '@/components/ViewerContext';
import { GoldenWorkspace } from './GoldenWorkspace';

async function mount() {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role: 'admin' }}><GoldenWorkspace /></ViewerProvider>);
  });
}
const dialog = () => screen.getByRole('dialog');
const footer = () => dialog().querySelector('.modal-footer') as HTMLElement;
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const title = () => within(dialog()).getByRole('heading', { level: 2 }).textContent;
const openRow = async (serial: string) => {
  await click(screen.getAllByText(serial, { selector: 'td *, td' })[0]!);
  await waitFor(() => expect(title()).toBe(serial));
};

beforeEach(() => { resetUrl(); push.mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); });

describe('Golden', () => {
  it('lists golden boards with Status first; "Chưa gắn" is a quick filter', async () => {
    await mount();
    expect(screen.getByText('GB-1')).toBeTruthy();
    await click(screen.getByRole('button', { name: /asset.quickUnattached/ }));
    expect(screen.queryByText('GB-1')).toBeNull();
    expect(screen.getByText('GB-2')).toBeTruthy();
  });

  it('an attached board shows where it is attached; the chip goes to the Equipment module', async () => {
    await mount();
    await openRow('GB-1');
    expect(within(footer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['dp.actionsMenu', 'common.edit', 'eq.checkIn']);
    await click(within(dialog()).getByRole('button', { name: 'FIXTURE-01' }));
    expect(push).toHaveBeenCalledWith('/equipment?id=e-fixture');
  });

  it('an unattached board offers "Gắn vào tester / fixture" and its menu has Attach instead of Change parent', async () => {
    await mount();
    await openRow('GB-2');
    await click(within(footer()).getByRole('button', { name: 'dp.actionsMenu' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(
      ['eq.swap', 'asset.attach.golden_board', 'eq.changeLocation', 'label.print', 'common.delete'],
    );
    await click(screen.getByRole('menuitem', { name: 'asset.attach.golden_board' }));
    expect(title()).toBe('asset.attach.golden_board');
  });

  it('Add: the location is required only while no parent is chosen; part number is free text', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { ...goldenRows[1]!, id: 'g9', serial_number: 'GB-9' }, meta: {} });
    await mount();
    await click(screen.getAllByRole('button', { name: /gs.add/ })[0]!);
    expect(dialog().classList.contains('modal-dialog--m')).toBe(true);
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.part_number/), { target: { value: 'PCBA-1' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.serial_number/), { target: { value: 'GB-9' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/fields.location/).closest('.dp-field') as HTMLElement).getByRole('alert').textContent).toBe('dp.required');
    await click(screen.getByLabelText(/fields.location/));
    await click(screen.getByRole('option', { name: 'B3F1' }));
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.post).toHaveBeenCalledWith('/api/golden', expect.objectContaining({ part_number: 'PCBA-1', serial_number: 'GB-9', location_id: 'l1' }));
  });
});
