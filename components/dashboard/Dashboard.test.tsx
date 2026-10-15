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

const dashboard = (activities: RecentAction[]): DashboardData & { activities: RecentAction[] } => ({
  equipment_total: 2, sub_equipment_total: 1, golden_total: 0,
  by_usage: { equipment: [], sub_equipment: [], golden_board: [] }, by_calibration_status: [], by_tag: [], by_location: [], by_type: [],
  overdue: [], due_soon: [], activities,
} as unknown as DashboardData & { activities: RecentAction[] });

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client/api')>()), api: { get } }));

import { ViewerProvider } from '@/components/ViewerContext';
import { Dashboard } from './Dashboard';

async function mount() {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role: 'admin' }}><Dashboard /></ViewerProvider>);
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
