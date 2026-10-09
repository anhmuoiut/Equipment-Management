// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${key}:${o.count}` : key), i18n: { language: 'en' } }),
}));
class IO { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO);

const rows = [
  { id: 'a', name: 'Alpha', n: 1 },
  { id: 'b', name: 'Bravo', n: 2 },
  { id: 'c', name: 'Charlie', n: 3 },
];
/** Per-test control of the single-record request: hold it, make it fail, or answer with newer data than the list has. */
const detail = vi.hoisted(() => ({ gates: new Map<string, Promise<void>>(), failing: new Set<string>(), fresher: new Set<string>() }));
vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(async (url: string) => {
        if (url === '/api/things') return { data: rows, meta: {} };
        await detail.gates.get(url);
        if (detail.failing.has(url)) throw new actual.ApiError('SERVER_ERROR', 'boom', {}, 'req_1', 500);
        const one = url.match(/^\/api\/things\/([^/?]+)/);
        const found = one ? rows.find((r) => r.id === one[1]) : undefined;
        if (!found) throw new actual.ApiError('NOT_FOUND', 'nf', {}, '-', 404);
        return { data: detail.fresher.has(url) ? { ...found, name: `${found.name}!` } : found, meta: {} };
      }),
      post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    },
  };
});

import { currentSearch, historyDepth, resetUrl } from '@/lib/client/testing/urlParamsMock';
import { Modal } from '@/components/ui';
import { ModuleWorkspace, useList, type DetailCtx } from './ModuleWorkspace';
import type { Column } from '@/components/ui/masterlist/Masterlist';

type Thing = { id: string; name: string; n: number };
const columns: Column<Thing>[] = [{ key: 'name', label: 'Name', value: (r) => r.name }];
let lastCtx: DetailCtx<Thing> | null = null;

function Page({ canAdd = true, withTool = false }: { canAdd?: boolean; withTool?: boolean }) {
  const list = useList<Thing>('/api/things');
  return (
    <ModuleWorkspace<Thing>
      title="Things" list={list} columns={columns} storageKey="things" exportName="things" canAdd={canAdd}
      recordUrl={(id) => `/api/things/${id}`}
      tools={withTool ? [{ key: 'import', label: 'Import', render: ({ onClose }) => <Modal size="l" title="Import tool" onClose={onClose}>tool body</Modal> }] : undefined}
      renderDetail={(ctx) => {
        lastCtx = ctx;
        return (
          <Modal size="l" title={ctx.record?.name ?? (ctx.creating ? 'Creating' : 'Loading')} onClose={ctx.onClose}>
            <span data-testid="state">{ctx.creating ? 'creating' : ctx.record ? `record:${ctx.record.name}` : ctx.error ? `error:${ctx.error}` : 'loading'}</span>
            <span data-testid="trail">{ctx.trail.map((t) => t.label).join('>')}</span>
            <button type="button" onClick={ctx.nav.onNext}>next</button>
            <button type="button" onClick={ctx.nav.onPrev}>prev</button>
            <button type="button" onClick={() => ctx.open('c', ctx.record?.name ?? '')}>open-related</button>
          </Modal>
        );
      }}
    />
  );
}

const mountPage = async (props: Parameters<typeof Page>[0] = {}) => { await act(async () => { render(<Page {...props} />); }); };
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => { resetUrl(); lastCtx = null; detail.gates.clear(); detail.failing.clear(); detail.fresher.clear(); });

describe('ModuleWorkspace', () => {
  it('shows the list full width with the count in the heading and no modal until something is opened', async () => {
    await mountPage();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Things');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.ws-panel')).toBeNull();
  });

  it('clicking a row opens its modal with ?id= pushed on the history; the record is fetched by id', async () => {
    await mountPage();
    await click(screen.getByText('Bravo'));
    expect(currentSearch()).toBe('id=b');
    expect(historyDepth()).toBe(1);
    expect(state()).toBe('record:Bravo');
  });

  it('a row opens instantly with the data the list already has; the fetched record then replaces it', async () => {
    let release!: () => void;
    detail.gates.set('/api/things/b', new Promise<void>((resolve) => { release = resolve; }));
    detail.fresher.add('/api/things/b');
    await mountPage();
    await click(screen.getByText('Bravo'));
    expect(state()).toBe('record:Bravo'); // before the server has answered — no skeleton
    await act(async () => { release(); });
    expect(state()).toBe('record:Bravo!'); // the up-to-date record took over
  });

  it('if the record cannot be loaded the list data gives way to the error (never a stale record left on screen)', async () => {
    detail.failing.add('/api/things/a');
    await mountPage();
    await click(screen.getByText('Alpha'));
    expect(state()).toMatch(/^error:/);
  });

  it('a ?id= link opens the modal straight away; an unknown id shows the error with Close', async () => {
    resetUrl('id=c');
    await mountPage();
    expect(state()).toBe('record:Charlie');
    // Không có lịch sử được đẩy: đóng bằng replace.
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.close' }));
    expect(currentSearch()).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    resetUrl('id=zzz');
    await act(async () => { render(<Page />); });
    expect(screen.getAllByTestId('state').at(-1)!.textContent).toBe('error:errors.NOT_FOUND');
  });

  it('closing a modal that was opened from the list goes Back in history (one step), so the list URL is exactly as before', async () => {
    await mountPage();
    await click(screen.getByText('Alpha'));
    expect(historyDepth()).toBe(1);
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.close' }));
    expect(historyDepth()).toBe(0);
    expect(currentSearch()).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('‹ › move through the list in its current order and replace the URL (no extra history)', async () => {
    await mountPage();
    await click(screen.getByText('Alpha'));
    expect(lastCtx!.nav.onPrev).toBeUndefined();
    await click(screen.getByRole('button', { name: 'next' }));
    expect(currentSearch()).toBe('id=b');
    expect(state()).toBe('record:Bravo');
    expect(historyDepth()).toBe(1);
    await click(screen.getByRole('button', { name: 'next' }));
    expect(state()).toBe('record:Charlie');
    expect(lastCtx!.nav.onNext).toBeUndefined();
    await click(screen.getByRole('button', { name: 'prev' }));
    expect(state()).toBe('record:Bravo');
  });

  it('opening a related record keeps a trail for the breadcrumb and returns to it on request', async () => {
    await mountPage();
    await click(screen.getByText('Alpha'));
    await click(screen.getByRole('button', { name: 'open-related' }));
    expect(currentSearch()).toBe('id=c');
    expect(state()).toBe('record:Charlie');
    expect(screen.getByTestId('trail').textContent).toBe('Alpha');
    await act(async () => { lastCtx!.trail[0]!.onClick(); });
    expect(currentSearch()).toBe('id=a');
    expect(screen.getByTestId('trail').textContent).toBe('');
  });

  it('+ Thêm opens the create modal (?new=1); saving a new row puts ?id= in its place and adds the row to the list', async () => {
    await mountPage();
    await click(screen.getAllByRole('button', { name: 'ml.add' })[0]!);
    expect(currentSearch()).toBe('new=1');
    expect(state()).toBe('creating');
    await act(async () => { lastCtx!.onSaved({ id: 'd', name: 'Delta', n: 4 }, true); });
    expect(currentSearch()).toBe('id=d');
    expect(screen.getAllByText('Delta').length).toBeGreaterThan(0);
  });

  it('?new=1 is ignored for viewers who cannot add', async () => {
    resetUrl('new=1');
    await mountPage({ canAdd: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.ws-add-fab')).toBeNull();
  });

  it('the floating + is shown on the list and hidden while a modal is open', async () => {
    await mountPage();
    expect(document.querySelector('.ws-add-fab')).toBeTruthy();
    await click(screen.getByText('Alpha'));
    expect(document.querySelector('.ws-add-fab')).toBeNull();
  });

  it('a deleted record leaves the list and the modal closes', async () => {
    await mountPage();
    await click(screen.getByText('Bravo'));
    await act(async () => { lastCtx!.onDeleted(rows[1]!); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Bravo')).toBeNull();
  });

  it('a tool opens in its own modal (?tool=) and closes like any other', async () => {
    await mountPage({ withTool: true });
    await click(screen.getByRole('button', { name: /Import/ }));
    expect(currentSearch()).toBe('tool=import');
    expect(screen.getByText('tool body')).toBeTruthy();
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?q= fills the search box', async () => {
    resetUrl('q=Brav');
    await mountPage();
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
  });
});
