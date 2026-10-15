// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/overview', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

import { boardResponse, dmm2, equipmentRows, options, treeResponse } from '@/lib/client/testing/assetFixtures';
import type { OverviewBoard } from '@/lib/types';

const calls: string[] = [];
let board: (query: URLSearchParams) => OverviewBoard = () => boardResponse;
function respond(url: string): { data: unknown; meta?: Record<string, unknown> } {
  calls.push(url);
  const [path, query = ''] = url.split('?');
  if (path === '/api/options') return { data: options };
  if (path === '/api/overview') return { data: board(new URLSearchParams(query)) };
  const equipmentOne = path!.match(/^\/api\/equipment\/([^/]+)$/);
  if (equipmentOne) return { data: equipmentRows.find((r) => r.id === equipmentOne[1]) };
  if (path === '/api/calibration/s2') return { data: dmm2 };
  if (path === '/api/calibration/s2/records') return { data: [] };
  if (path!.endsWith('/tree')) return { data: treeResponse };
  if (path!.endsWith('/history')) return { data: [] };
  throw new Error('unexpected GET ' + url);
}
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return { ...actual, api: { get: vi.fn(async (url: string) => ({ meta: {}, ...respond(url) })), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { ApiError, api } from '@/lib/client/api';
import { currentSearch, resetUrl } from '@/lib/client/testing/urlParamsMock';
import { ViewerProvider } from '@/components/ViewerContext';
import { OverviewPage } from './OverviewPage';

async function mount() {
  await act(async () => {
    render(<ViewerProvider viewer={{ userId: 'u1', username: 'admin', fullName: 'Ann', role: 'admin' }}><OverviewPage /></ViewerProvider>);
  });
}
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const boardCalls = () => calls.filter((c) => c.startsWith('/api/overview'));
const column = (serial: string) => screen.getByRole('group', { name: serial });
const card = (serial: string) => screen.getByRole('button', { name: new RegExp(`(^|\\s)${serial}(,|$)`) });
const sectionButton = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  resetUrl(); calls.length = 0; push.mockReset(); board = () => boardResponse;
  vi.mocked(api.get).mockImplementation(async (url: string) => ({ meta: {}, ...respond(url) }));
});

describe('Overview board — one load, sections per Location, one column per root asset', () => {
  it('loads the whole board with ONE call and draws a section per Location with its numbers', async () => {
    await mount();
    expect(boardCalls()).toEqual(['/api/overview']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('nav.overview');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining('B3F1'), expect.stringContaining('B3F2'),
    ]);
    const head = sectionButton('B3F1');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(head.textContent).toContain('ov.testers{"count":1}');
    expect(head.textContent).toContain('ov.inUse{"count":1}');
    // the ⚠ number is red because a column of the section is overdue; B3F2 has none
    expect(within(head).getByLabelText('ov.alerts{"count":1}').getAttribute('data-tone')).toBe('alert');
    expect(within(sectionButton('B3F2')).getByLabelText('ov.alerts{"count":0}').getAttribute('data-tone')).toBeNull();
    expect(Array.from(document.querySelectorAll('.ob-col')).map((g) => g.getAttribute('aria-label'))).toEqual(['TESTER-01', 'BASE-02', 'TESTER-09']);
  });

  it('a card shows operating and deadline tags together without icons; the border is operating status', async () => {
    await mount();
    const root = within(column('TESTER-01')).getAllByRole('button')[0]!;
    expect(root.getAttribute('data-root')).toBe('true');
    expect(root.getAttribute('data-status-color')).toBe('green');
    expect(root.textContent).toContain('Tester');
    expect(root.textContent).toContain('P12316');
    expect(root.textContent).toContain('TESTER-01');
    expect(root.getAttribute('aria-label')).toBe('Tester TESTER-01, ov.pn P12316, values.in_use, ov.alert: cal.status.overdue');
    expect(root.querySelector('[data-usage="in_use"]')?.textContent).toBe('values.in_use');
    expect(root.querySelector('[data-cal-status="overdue"]')?.textContent).toBe('cal.status.overdue');
    expect(root.querySelector('svg')).toBeNull();
    const loose = within(column('BASE-02')).getByRole('button');
    expect(loose.getAttribute('data-status-color')).toBe('gray');
    expect(loose.querySelector('[data-usage="not_in_use"]')?.textContent).toBe('values.not_in_use');
    expect(loose.querySelector('[data-cal-status]')).toBeNull();
    const sub = within(column('TESTER-01')).getByRole('button', { name: /DMM-2/ });
    expect(sub.textContent).toContain('ov.subType{"type":"DMM"}');
    expect(sub.getAttribute('data-root')).toBeNull();
    expect(sub.getAttribute('aria-label')).toContain('ov.childOf{"serial":"TESTER-01"}');
  });

  it('a column is at most 3 cards (root + 2) with tree lines (├ └), and the rest is "+N thiết bị" as the last branch', async () => {
    await mount();
    expect(within(column('TESTER-01')).getAllByRole('button').filter((b) => b.classList.contains('ob-card'))).toHaveLength(3);
    const rows = Array.from(column('TESTER-01').querySelectorAll('.ob-row'));
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('BASE-01'), expect.stringContaining('DMM-2'), 'ov.more{"count":4}',
    ]);
    const guides = rows.map((r) => Array.from(r.querySelectorAll('.ob-guide')).map((g) => g.getAttribute('data-kind') ?? 'blank'));
    expect(guides).toEqual([['mid'], ['mid'], ['last']]);
    expect(column('TESTER-01').querySelectorAll('.ob-guide[aria-hidden="true"]')).toHaveLength(3);
    expect(column('BASE-02').querySelector('.ob-row')).toBeNull();
  });

  it('a section collapses and opens again from its header (button, aria-expanded)', async () => {
    await mount();
    await click(sectionButton('B3F1'));
    expect(sectionButton('B3F1').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'TESTER-01' })).toBeNull();
    expect(screen.getByRole('group', { name: 'TESTER-09' })).toBeTruthy();
    await click(sectionButton('B3F1'));
    expect(screen.getByRole('group', { name: 'TESTER-01' })).toBeTruthy();
  });

  it('nothing at all: the empty state, no add button (Overview only reads)', async () => {
    board = () => ({ sections: [] });
    await mount();
    expect(screen.getByText('ov.empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('a failed first load shows the error with Retry; Retry loads the board', async () => {
    let fail = true;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/overview') && fail) { fail = false; throw new ApiError('NETWORK_ERROR', 'x', {}, '-', 0); }
      return { meta: {}, ...respond(url) };
    });
    await mount();
    await click(await screen.findByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'TESTER-01' })).toBeTruthy());
  });
});

describe('Overview board — opening a record', () => {
  it('a child card opens ITS owning module\'s modal: equipment → Equipment, sub_equipment → Calibration; no tab is preselected', async () => {
    await mount();
    await click(within(column('TESTER-01')).getByRole('button', { name: /^Base BASE-01/ }));
    expect(currentSearch()).toBe('id=e-base&type=equipment');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('BASE-01'));
    expect(within(dialog).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
    await click(within(dialog).getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentSearch()).toBe('');

    await click(within(column('TESTER-01')).getByRole('button', { name: /DMM-2/ }));
    expect(currentSearch()).toBe('id=s2&type=sub_equipment');
    const sub = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sub).getByRole('heading', { level: 2 }).textContent).toBe('DMM-2'));
    expect(within(sub.querySelector('.modal-footer') as HTMLElement).getByRole('button', { name: 'cal.record' })).toBeTruthy();
  });

  it('the root card opens the combined desktop detail (?tab=tree); so does "+N thiết bị"', async () => {
    await mount();
    await click(within(column('TESTER-01')).getAllByRole('button')[0]!);
    expect(currentSearch()).toBe('id=e-tester&type=equipment&tab=tree');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(within(dialog).getByRole('tree')).toBeTruthy());
    // the tree and the children chips come from ONE request
    expect(calls.filter((c) => c.startsWith('/api/equipment/e-tester/tree'))).toHaveLength(1);
    await click(within(dialog).getByRole('button', { name: 'common.close' }));
    expect(currentSearch()).toBe('');

    await click(screen.getByRole('button', { name: /ov.moreLabel/ }));
    expect(currentSearch()).toBe('id=e-tester&type=equipment&tab=tree');
  });

  it('a root without anything below it (loose Base) opens on the Info tab, not the tree', async () => {
    await mount();
    await click(within(column('BASE-02')).getByRole('button'));
    expect(currentSearch()).toBe('id=e-spare&type=equipment');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('BASE-02'));
    expect(within(dialog).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
  });

  it('a ?id=&type=&tab=tree link opens the combined desktop detail on load', async () => {
    resetUrl('id=e-tester&type=equipment&tab=tree');
    await mount();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('TESTER-01'));
    expect(within(dialog).getByRole('tab', { name: 'dp.tabInfo' }).getAttribute('aria-selected')).toBe('true');
    expect(dialog.classList.contains('modal-dialog--l')).toBe(true);
  });

  it('opening a related record from inside the modal drops the tab', async () => {
    resetUrl('id=e-tester&type=equipment&tab=tree');
    await mount();
    const dialog = await screen.findByRole('dialog');
    await click(await within(await within(dialog).findByRole('tree')).findByText('BASE-01'));
    await waitFor(() => expect(currentSearch()).toBe('id=e-base&type=equipment'));
  });
});

describe('Overview board — filters', () => {
  it('Status buttons ask the server; "All" asks for the whole board again', async () => {
    await mount();
    await click(screen.getByRole('button', { name: 'values.in_use' }));
    await waitFor(() => expect(boardCalls()).toContain('/api/overview?usage=in_use'));
    expect(screen.getByRole('button', { name: 'values.in_use' }).getAttribute('aria-pressed')).toBe('true');
    await click(screen.getByRole('button', { name: 'values.not_in_use' }));
    await waitFor(() => expect(boardCalls()).toContain('/api/overview?usage=not_in_use'));
    await click(screen.getByRole('button', { name: 'ml.all' }));
    await waitFor(() => expect(boardCalls().filter((c) => c === '/api/overview')).toHaveLength(2));
  });

  it('Type and search ask the server (search after a pause); matched cards are highlighted, the rest are not dimmed', async () => {
    board = (q) => (q.get('q') ? {
      sections: [{
        ...boardResponse.sections[0]!, columns: [{
          ...boardResponse.sections[0]!.columns[0]!,
          cards: boardResponse.sections[0]!.columns[0]!.cards.map((c) => ({ ...c, matched: c.serial_number === 'DMM-2' })),
        }],
      }],
    } : boardResponse);
    await mount();
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(screen.getByRole('button', { name: 'ov.kind' }));
    await user.click(screen.getByRole('option', { name: 'ov.kinds.sub_equipment' }));
    await waitFor(() => expect(boardCalls()).toContain('/api/overview?kind=sub_equipment'));
    await act(async () => { fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dmm' } }); });
    expect(boardCalls()).not.toContain('/api/overview?kind=sub_equipment&q=dmm'); // not before the pause
    await waitFor(() => expect(boardCalls()).toContain('/api/overview?kind=sub_equipment&q=dmm'), { timeout: 2000 });
    await waitFor(() => expect(within(column('TESTER-01')).getByRole('button', { name: /DMM-2/ }).getAttribute('data-matched')).toBe('true'));
    expect(within(column('TESTER-01')).getByRole('button', { name: /DMM-2/ }).getAttribute('aria-label')).toContain('ov.matched');
    expect(within(column('TESTER-01')).getByRole('button', { name: /^Base BASE-01/ }).getAttribute('data-matched')).toBeNull();
    expect(screen.queryByRole('group', { name: 'TESTER-09' })).toBeNull(); // only columns with a match stay
  });

  it('a Status-only filter keeps the columns but highlights nothing (every card of such a column matches)', async () => {
    board = () => ({ sections: [{ ...boardResponse.sections[0]!, columns: [{ ...testerColumnMatched() }] }] });
    await mount();
    await click(screen.getByRole('button', { name: 'values.in_use' }));
    await waitFor(() => expect(boardCalls()).toContain('/api/overview?usage=in_use'));
    expect(document.querySelectorAll('[data-matched]')).toHaveLength(0);
  });

  it('filtering opens every section (even a collapsed one); clearing the filter brings the collapsed state back', async () => {
    await mount();
    await click(sectionButton('B3F1'));
    expect(sectionButton('B3F1').getAttribute('aria-expanded')).toBe('false');
    await click(screen.getByRole('button', { name: 'values.in_use' }));
    expect(sectionButton('B3F1').getAttribute('aria-expanded')).toBe('true');
    await click(screen.getByRole('button', { name: 'ml.all' }));
    expect(sectionButton('B3F1').getAttribute('aria-expanded')).toBe('false');
  });

  it('a filter that matches nothing says so and offers "Xóa bộ lọc"; the old board stays while the new one loads', async () => {
    await mount();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/api/overview?usage=in_use') { await pending; return { meta: {}, data: { sections: [] } }; }
      return { meta: {}, ...respond(url) };
    });
    await click(screen.getByRole('button', { name: 'values.in_use' }));
    expect(screen.getByRole('group', { name: 'TESTER-01' })).toBeTruthy(); // no flash back to a skeleton
    expect(screen.getByRole('region', { name: 'ov.board' }).getAttribute('aria-busy')).toBe('true');
    await act(async () => { release(); });
    expect(await screen.findByText('ov.noMatch')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'ml.clearFilters' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'TESTER-01' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'ml.all' }).getAttribute('aria-pressed')).toBe('true');
  });
});

/** The TESTER-01 column with every card marked as matched (what the database sends for a Status filter). */
function testerColumnMatched() {
  const col = boardResponse.sections[0]!.columns[0]!;
  return { ...col, cards: col.cards.map((c) => ({ ...c, matched: true })) };
}
