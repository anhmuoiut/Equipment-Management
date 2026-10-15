// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length && !('defaultValue' in o) ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));

import type { DashboardData, RecentAction } from '@/lib/types';

/** One action = one row. */
const action = (n: number): RecentAction => ({
  id: `act-${String(n).padStart(3, '0')}`, module: 'equipment', modules: ['equipment'], action: 'UPDATE', source: 'ui',
  created_by: 'u1', created_by_name: 'Ann', created_at: `2026-10-15T0${n % 10}:00:00Z`, item_count: 1,
  records: [{ module: 'equipment', object_id: `e${n}`, label: `SN-${String(n).padStart(3, '0')}`, action: 'UPDATE', changes: {}, note: null }],
});
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => action(from + i));

const dashboard = (activities: RecentAction[], totals: [number, number, number] = [2, 1, 0]): DashboardData & { activities: RecentAction[] } => ({
  equipment_total: totals[0], sub_equipment_total: totals[1], golden_total: totals[2],
  by_usage: { equipment: [], sub_equipment: [], golden_board: [] }, by_calibration_status: [], by_tag: [], by_location: [], by_type: [],
  overdue: [], due_soon: [], activities,
} as unknown as DashboardData & { activities: RecentAction[] });

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client/api')>()), api: { get } }));

import { ApiError } from '@/lib/client/api';
import type { Role } from '@/lib/permissions';
import { ViewerProvider } from '@/components/ViewerContext';
import { Dashboard } from './Dashboard';

async function mount(role: Role = 'admin') {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role }}><Dashboard /></ViewerProvider>);
  });
}
const urls = () => get.mock.calls.map((c) => c[0] as string);
const shown = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('.act-sentence')?.textContent ?? '');
const loadMore = () => screen.queryByRole('button', { name: 'dash.loadMore' });

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url === '/api/dashboard') return { data: dashboard(page(0, 50)), meta: {} };
    const offset = Number(new URL(url, 'http://x').searchParams.get('offset') ?? 0);
    const moduleFilter = new URL(url, 'http://x').searchParams.get('module');
    if (moduleFilter) return { data: page(500, 5), meta: {} };
    return { data: page(offset, offset === 0 ? 50 : 20), meta: {} };
  });
});

describe('Dashboard — Recent changes load page by page', () => {
  it('shows the first 50 actions that came with the dashboard (no extra request) and offers more', async () => {
    await mount();
    await waitFor(() => expect(shown()).toHaveLength(50));
    expect(urls()).toEqual(['/api/dashboard']);
    expect(loadMore()).toBeTruthy();
  });

  it('"Load more" asks ONLY for the next page, appends it, and hides itself when the page is short', async () => {
    await mount();
    await waitFor(() => expect(shown()).toHaveLength(50));
    await act(async () => { fireEvent.click(loadMore()!); });
    await waitFor(() => expect(shown()).toHaveLength(70));
    expect(urls()).toEqual(['/api/dashboard', '/api/dashboard/activities?limit=50&offset=50']); // the first 50 are not read again
    expect(loadMore()).toBeNull(); // the last page had 20 (< 50): nothing left
  });

  it('actions that appeared between two loads are not listed twice', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/dashboard') return { data: dashboard(page(0, 50)), meta: {} };
      return { data: [...page(48, 2), ...page(50, 10)], meta: {} }; // two of them were already on screen
    });
    await mount();
    await waitFor(() => expect(shown()).toHaveLength(50));
    await act(async () => { fireEvent.click(loadMore()!); });
    await waitFor(() => expect(shown()).toHaveLength(60)); // 50 + 12 returned − the 2 it already had
  });

  it('changing the module filter goes back to the first page of that filter and drops the appended pages', async () => {
    await mount();
    await waitFor(() => expect(shown()).toHaveLength(50));
    await act(async () => { fireEvent.click(loadMore()!); });
    await waitFor(() => expect(shown()).toHaveLength(70));
    await act(async () => { fireEvent.click(screen.getByLabelText('dash.module')); });
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'dash.moduleName.sub_equipment' })); });
    await waitFor(() => expect(shown()).toHaveLength(5));
    expect(urls().at(-1)).toBe('/api/dashboard/activities?limit=50&module=sub_equipment');
  });

  it('a failed "Load more" shows the error with a retry, and keeps the rows already on screen', async () => {
    await mount();
    await waitFor(() => expect(shown()).toHaveLength(50));
    get.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { fireEvent.click(loadMore()!); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy());
    expect(shown()).toHaveLength(50);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.retry' })); });
    await waitFor(() => expect(shown()).toHaveLength(70));
  });
});

const failure = () => new ApiError('DATABASE_OUT_OF_DATE', 'x', {}, 'req_8d22f1ae', 503);
const tiles = () => [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent);

describe('Dashboard — when the numbers cannot be loaded (for example the database is behind the app)', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/dashboard') throw failure();
      return { data: page(0, 50), meta: {} };
    });
  });

  it('is not a blank page: it says so with the reference and a Retry, keeps the five tiles (as "—") and still lists Recent changes', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('dash.unavailable')).toBeTruthy());
    expect(screen.getByText('dash.unavailableHint')).toBeTruthy();
    expect(screen.getByText(/errors.DATABASE_OUT_OF_DATE/)).toBeTruthy(); // the actionable message…
    expect(screen.getByText('req_8d22f1ae').tagName).toBe('CODE'); // …and the reference, copyable
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
    expect(tiles()).toEqual(['—', '—', '—', '—', '—']);
    await waitFor(() => expect(shown()).toHaveLength(50)); // Recent changes came from its own request
    expect(urls()).toEqual(['/api/dashboard', '/api/dashboard/activities?limit=50']);
  });

  it('Retry asks for the numbers again and, when they arrive, replaces the notice with the real dashboard', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('dash.unavailable')).toBeTruthy());
    get.mockImplementation(async (url: string) => (url === '/api/dashboard' ? { data: dashboard(page(0, 50)), meta: {} } : { data: page(0, 50), meta: {} }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.retry' })); });
    await waitFor(() => expect(screen.queryByText('dash.unavailable')).toBeNull());
    await waitFor(() => expect(tiles().slice(0, 2)).toEqual(['2', '1']));
  });

  it('if Recent changes also fails it shows its own error card and the rest of the page stays', async () => {
    get.mockImplementation(async () => { throw failure(); });
    await mount();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByText('dash.unavailable')).toBeTruthy();
    expect(screen.getByText('dash.recent')).toBeTruthy();
  });
});

describe('Dashboard — an empty system says what to do first', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => (url === '/api/dashboard' ? { data: dashboard([], [0, 0, 0]), meta: {} } : { data: [], meta: {} }));
  });
  const links = () => [...document.querySelectorAll('.dash-welcome a')].map((a) => a.getAttribute('href'));

  it('an Admin gets the three first steps: Configuration, import, add', async () => {
    await mount('admin');
    await waitFor(() => expect(screen.getByText('dash.welcomeTitle')).toBeTruthy());
    expect(screen.getByText('dash.welcomeText')).toBeTruthy();
    expect(links()).toEqual(['/configuration', '/equipment?tool=import', '/equipment?new=1']);
  });

  it('a User can import or add but does not get the Configuration link (Admin only)', async () => {
    await mount('user');
    await waitFor(() => expect(screen.getByText('dash.welcomeTitle')).toBeTruthy());
    expect(links()).toEqual(['/equipment?tool=import', '/equipment?new=1']);
  });

  it('a read-only user is only told it is empty — no buttons that lead to actions they cannot do', async () => {
    await mount('readonly');
    await waitFor(() => expect(screen.getByText('dash.welcomeReadonly')).toBeTruthy());
    expect(links()).toEqual([]);
  });

  it('not shown as soon as there is any asset', async () => {
    get.mockImplementation(async (url: string) => (url === '/api/dashboard' ? { data: dashboard([], [0, 0, 1]), meta: {} } : { data: [], meta: {} }));
    await mount();
    await waitFor(() => expect(tiles()).toEqual(['0', '0', '0', '0', '1']));
    expect(screen.queryByText('dash.welcomeTitle')).toBeNull();
  });
});
