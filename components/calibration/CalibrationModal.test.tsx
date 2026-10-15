// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/calibration', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

import { audit, dmm1, options, subRows } from '@/lib/client/testing/assetFixtures';
import type { CalibrationRecord } from '@/lib/types';

const records: CalibrationRecord[] = [
  { id: 'c2', sub_equipment_id: 's1', calibrated_at: '2026-06-01', due_date: '2027-06-01', vendor_id: 'v1', vendor: 'Internal', cert_no: 'C-2', cert_file_url: 'https://x/c2.pdf', result: 'pass', remark: null, ...audit },
  { id: 'c1', sub_equipment_id: 's1', calibrated_at: '2025-06-01', due_date: '2026-06-01', vendor_id: null, vendor: null, cert_no: null, cert_file_url: null, result: 'pass', remark: null, ...audit },
];
function respond(url: string): { data: unknown; meta?: Record<string, unknown> } {
  const [path] = url.split('?');
  if (path === '/api/options') return { data: options };
  if (path === '/api/calibration') return { data: subRows };
  const rec = path!.match(/^\/api\/calibration\/([^/]+)\/records$/);
  if (rec) return { data: records };
  const one = path!.match(/^\/api\/calibration\/([^/]+)$/);
  if (one) return { data: subRows.find((r) => r.id === one[1]) };
  if (path!.endsWith('/history')) return { data: [] };
  if (path === '/api/assets/serial-matches') return { data: [] };
  throw new Error('unexpected GET ' + url);
}
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async (url: string) => ({ meta: {}, ...respond(url) })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '@/lib/client/api';
import { resetUrl } from '@/lib/client/testing/urlParamsMock';
import { ViewerProvider } from '@/components/ViewerContext';
import { CalibrationWorkspace } from './CalibrationWorkspace';
import type { Role } from '@/lib/permissions';

async function mount(role: Role = 'admin') {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role }}><CalibrationWorkspace /></ViewerProvider>);
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

beforeEach(() => {
  resetUrl(); push.mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(api.put).mockReset(); vi.mocked(api.delete).mockReset();
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
});

describe('Calibration — masterlist', () => {
  it('a phone card shows In use and Overdue together', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    await mount();
    const card = screen.getByText('DMM-2').closest('.ml-card')!;
    expect(card.querySelector('[data-usage="in_use"]')?.textContent).toBe('values.in_use');
    expect(card.querySelector('[data-cal-status="overdue"]')?.textContent).toBe('cal.status.overdue');
  });

  it('Calibration status leads the columns; quick filters for overdue / due soon / not calibrated; overdue rows are marked', async () => {
    await mount();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers[1]).toMatch(/cal.calibrationStatus/);
    expect(screen.getByText('DMM-1')).toBeTruthy();
    await click(screen.getByRole('button', { name: /cal.status.overdue/ }));
    expect(screen.queryByText('DMM-1')).toBeNull();
    expect(screen.getByText('DMM-2')).toBeTruthy();
    expect(document.querySelector('tr[data-tone="alert"]')).toBeTruthy();
    await click(screen.getByRole('button', { name: /cal.quickAttention/ }));
    expect(screen.getByText('DMM-3')).toBeTruthy();
    expect(screen.queryByText('DMM-2')).toBeNull();
  });
});

describe('Calibration — modal', () => {
  it('footer: [Thao tác ▾] on the left; [Sửa] [Ghi nhận hiệu chuẩn] [Check-in] on the right with Check-in as the primary', async () => {
    await mount();
    await openRow('DMM-1');
    expect(within(footer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['dp.actionsMenu', 'common.edit', 'cal.record', 'eq.checkIn']);
    expect(within(footer()).getByRole('button', { name: 'eq.checkIn' }).className).toContain('ui-button--primary');
    expect(within(footer()).getByRole('button', { name: 'cal.record' }).className).toContain('ui-button--quiet');
  });

  it('header and groups: status, due date, tester chip, current calibration, cycle', async () => {
    await mount();
    await openRow('DMM-1');
    expect(within(dialog()).getAllByText('cal.status.valid').length).toBeGreaterThan(0);
    expect(within(dialog()).getByRole('button', { name: /TESTER-01/ })).toBeTruthy(); // the chip reads "SN · Type"
    expect(within(dialog()).getByText('fields.manufacturer')).toBeTruthy(); // from the part number, read-only
    expect(within(dialog()).getByText('Keysight')).toBeTruthy();
    expect(within(dialog()).getByText('cal.groupCurrent')).toBeTruthy();
    expect(within(dialog()).getByText('C-1')).toBeTruthy();
    expect(within(dialog()).getByText('cal.months{"count":12}')).toBeTruthy();
    await click(within(dialog()).getByRole('button', { name: /TESTER-01/ }));
    expect(push).toHaveBeenCalledWith('/equipment?id=e-tester');
  });

  it('a sub-equipment never calibrated says so and offers to attach it to a tester', async () => {
    await mount();
    await openRow('DMM-3');
    expect(within(dialog()).getByText('cal.noRecordsYet')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'asset.attach.sub_equipment' })).toBeTruthy();
    expect(within(dialog()).getAllByText('cal.status.not_calibrated').length).toBeGreaterThan(0);
  });

  it('Record calibration: previews "Hạn mới" from the cycle and posts the record; the modal returns to the detail', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { record: records[0], sub_equipment: { ...dmm1, calibrated_at: '2026-10-08' } }, meta: {} });
    await mount();
    await openRow('DMM-1');
    await click(within(footer()).getByRole('button', { name: 'cal.record' }));
    expect(title()).toBe('cal.record');
    await act(async () => { fireEvent.change(screen.getByLabelText(/fields.calibration_date/), { target: { value: '2026-10-08' } }); });
    // 12 tháng sau 08/10/2026
    expect(within(dialog()).getByText(/08\/10\/2027/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText('fields.cert_no'), { target: { value: 'C-9' } }); });
    await click(within(footer()).getByRole('button', { name: 'cal.record' }));
    expect(api.post).toHaveBeenCalledWith('/api/calibration/s1/records', { calibrated_at: '2026-10-08', result: 'pass', cert_no: 'C-9' });
    await waitFor(() => expect(title()).toBe('DMM-1'));
  });

  it('a part number with no cycle needs the due date typed in before the button works', async () => {
    await mount();
    await openRow('DMM-3');
    await click(within(footer()).getByRole('button', { name: 'cal.record' }));
    expect((within(footer()).getByRole('button', { name: 'cal.record' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.change(screen.getByLabelText(/cal.newDueDate/), { target: { value: '2027-01-01' } }); });
    expect((within(footer()).getByRole('button', { name: 'cal.record' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('the Calibrations tab lists every record newest first; a pencil opens the edit screen for that record', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { record: records[0], sub_equipment: dmm1 }, meta: {} });
    await mount();
    await openRow('DMM-1');
    await click(within(dialog()).getByRole('tab', { name: 'cal.tabRecords' }));
    await waitFor(() => expect(within(dialog()).getByText('C-2')).toBeTruthy());
    const rows = within(dialog()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    await click(within(rows[0]!).getByRole('button', { name: 'cal.editRecord' }));
    expect(title()).toBe('cal.editRecord');
    // Admin xóa được lần này.
    expect(within(dialog()).getByRole('button', { name: 'cal.removeRecord' })).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText('fields.cert_no'), { target: { value: 'C-2b' } }); });
    await click(within(footer()).getByRole('button', { name: 'common.save' }));
    expect(api.put).toHaveBeenCalledWith('/api/calibration/records/c2', { cert_no: 'C-2b' });
  });

  it('a User can edit a record but cannot delete it', async () => {
    await mount('user');
    await openRow('DMM-1');
    await click(within(dialog()).getByRole('tab', { name: 'cal.tabRecords' }));
    await waitFor(() => expect(within(dialog()).getByText('C-2')).toBeTruthy());
    await click(within(within(dialog()).getAllByRole('row')[1]!).getByRole('button', { name: 'cal.editRecord' }));
    expect(within(dialog()).queryByRole('button', { name: 'cal.removeRecord' })).toBeNull();
  });

  it('the history tab can be narrowed to the calibrations only', async () => {
    await mount();
    await openRow('DMM-2');
    await click(within(dialog()).getByRole('tab', { name: 'dp.tabHistory' }));
    await click(await within(dialog()).findByRole('checkbox', { name: 'cal.onlyCalibrations' }));
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/calibration/s2/history?only=calibrations'));
  });
});

describe('Calibration — add', () => {
  it('Add is a form for a new sub-equipment: only sub-equipment part numbers, tester optional', async () => {
    await mount();
    await click(screen.getAllByRole('button', { name: /cal.add/ })[0]!);
    expect(dialog().classList.contains('modal-dialog--m')).toBe(true);
    await click(screen.getByLabelText(/fields.part_number/));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['DMM-100']);
  });
});

