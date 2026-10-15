// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client/api')>()), api: { get } }));

import { pagedCache, STALE_MS } from './cache';
import { pagedResponse } from './testing/pagedServer';
import { resetUrl } from './testing/urlParamsMock';
import { pagedUrl, usePagedList } from './usePagedList';
import { EMPTY_QUERY } from './listState';

type Row = { id: string; name: string };
const all: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}`, name: i % 2 ? `odd ${i}` : `even ${i}` }));
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const hook = () => renderHook(() => usePagedList<Row>('/api/things', { storageKey: 'things' }));
const urls = () => get.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  pagedCache.clear();
  resetUrl();
  window.localStorage.clear();
  get.mockReset();
  get.mockImplementation(async (url: string) => pagedResponse(all, url));
});
afterEach(() => { vi.useRealTimers(); });

describe('usePagedList — one page at a time', () => {
  it('opens with ONE request for page 1 of 50 — never the whole table', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    expect(urls()).toEqual(['/api/things?page=1&pageSize=50']);
    expect(result.current.paged).toMatchObject({ total: 120, page: 1, pageSize: 50 });
    expect(result.current.rows[0]!.id).toBe('r000');
    expect(result.current.loading).toBe(false);
  });

  it('the next page asks for page 2 only; coming back to a page seen a moment ago makes no request at all', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setPage(2));
    await waitFor(() => expect(result.current.rows[0]!.id).toBe('r050'));
    expect(urls()).toEqual(['/api/things?page=1&pageSize=50', '/api/things?page=2&pageSize=50']);
    act(() => result.current.paged!.setPage(1));
    await waitFor(() => expect(result.current.rows[0]!.id).toBe('r000'));
    expect(urls()).toHaveLength(2); // page 1 came from memory
    act(() => result.current.paged!.setPage(2));
    await waitFor(() => expect(result.current.rows[0]!.id).toBe('r050'));
    expect(urls()).toHaveLength(2);
  });

  it('keeps the page on screen while the next one loads (no empty flash)', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    const hold = deferred<ReturnType<typeof pagedResponse>>();
    get.mockReturnValueOnce(hold.promise);
    act(() => result.current.paged!.setPage(2));
    expect(result.current.rows[0]!.id).toBe('r000'); // still the old page…
    expect(result.current.paged!.fetching).toBe(true); // …marked as loading
    await act(async () => { hold.resolve(pagedResponse(all, '/api/things?page=2&pageSize=50')); });
    await waitFor(() => expect(result.current.rows[0]!.id).toBe('r050'));
    expect(result.current.paged!.fetching).toBe(false);
  });

  it('a page older than the freshness window is shown at once and refreshed in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const first = hook();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(50));
    first.unmount();
    vi.setSystemTime(Date.now() + STALE_MS + 1000);
    const second = hook();
    expect(second.result.current.rows).toHaveLength(50); // from memory, in the very first render…
    expect(second.result.current.paged!.fetching).toBe(true); // …while it is refreshed
    await waitFor(() => expect(urls()).toHaveLength(2)); // the background refresh was asked
  });

  it('a fresh page is reused when the screen is opened again (no request)', async () => {
    const first = hook();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(50));
    first.unmount();
    const second = hook();
    await waitFor(() => expect(second.result.current.rows).toHaveLength(50));
    expect(urls()).toHaveLength(1);
  });
});

describe('usePagedList — search, filters, sort', () => {
  it('a new search / filter / sort goes back to page 1 and is sent to the server', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setPage(3));
    await waitFor(() => expect(result.current.paged!.page).toBe(3));
    act(() => result.current.paged!.setQuery({ q: 'odd' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/things?page=1&pageSize=50&q=odd'));
    expect(result.current.paged!.page).toBe(1);
    await waitFor(() => expect(result.current.paged!.total).toBe(60));

    act(() => result.current.paged!.setQuery({ sort: { key: 'name', dir: 'desc' }, filters: { type: 'x' }, quick: 'attention', enums: { status: ['valid'] } }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/things?page=1&pageSize=50&q=odd&sort=name&dir=desc&quick=attention&qe=status%3Avalid&f.type=x'));
  });

  it('saying the same thing again changes nothing (no reset of the page, no request)', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setPage(2));
    await waitFor(() => expect(result.current.rows[0]!.id).toBe('r050'));
    const before = urls().length;
    act(() => result.current.paged!.setQuery({ q: '', filters: {}, sort: null, quick: null, enums: {} }));
    expect(result.current.paged!.page).toBe(2);
    expect(urls()).toHaveLength(before);
  });

  it('the search text in the URL (?q=) is the first search — one request, not two', async () => {
    resetUrl('q=even');
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    expect(urls()).toEqual(['/api/things?page=1&pageSize=50&q=even']);
    expect(result.current.paged!.query.q).toBe('even');
  });

  it('the answer to an OUTDATED request is ignored', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    const slow = deferred<ReturnType<typeof pagedResponse>>();
    const fast = deferred<ReturnType<typeof pagedResponse>>();
    get.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    act(() => result.current.paged!.setQuery({ q: 'a' }));
    act(() => result.current.paged!.setQuery({ q: 'ab' }));
    await act(async () => { fast.resolve(pagedResponse(all, '/api/things?q=odd')); });
    await waitFor(() => expect(result.current.paged!.total).toBe(60));
    await act(async () => { slow.resolve(pagedResponse(all, '/api/things?q=even&pageSize=25')); }); // arrives late
    expect(result.current.paged!.total).toBe(60); // the newer answer stays
  });
});

describe('usePagedList — page size', () => {
  it('changing the size goes to page 1 and is remembered for the next visit', async () => {
    const first = hook();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(50));
    act(() => first.result.current.paged!.setPage(2));
    act(() => first.result.current.paged!.setPageSize(25));
    await waitFor(() => expect(first.result.current.rows).toHaveLength(25));
    expect(first.result.current.paged).toMatchObject({ page: 1, pageSize: 25 });
    expect(urls().at(-1)).toBe('/api/things?page=1&pageSize=25');
    first.unmount();
    pagedCache.clear();
    const second = hook();
    await waitFor(() => expect(second.result.current.rows).toHaveLength(25));
    expect(second.result.current.paged!.pageSize).toBe(25);
  });

  it('only 25, 50 and 100 are accepted', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setPageSize(7));
    expect(result.current.paged!.pageSize).toBe(50);
  });
});

describe('usePagedList — pages past the end, errors, exports', () => {
  it('a page past the end is replaced by the last page the server returns — without asking again', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setPage(9));
    await waitFor(() => expect(result.current.paged!.page).toBe(3)); // 120 rows / 50 = 3 pages
    expect(result.current.rows).toHaveLength(20);
    expect(urls().filter((u) => u.includes('page=9'))).toHaveLength(1);
    expect(urls().filter((u) => u.includes('page=3'))).toHaveLength(0); // the clamped page was not requested separately
  });

  it('an empty result is an empty page 1, not an error', async () => {
    get.mockImplementation(async (url: string) => pagedResponse([] as Row[], url));
    const { result } = hook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.paged).toMatchObject({ total: 0, page: 1 });
    expect(result.current.error).toBeNull();
  });

  it('a failed request shows an error and keeps the rows that were on screen', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    get.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.paged!.setQuery({ q: 'x' }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.rows).toHaveLength(50);
  });

  it('Export asks for every matching row in ONE request, without a page number', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.paged!.setQuery({ q: 'odd' }));
    await waitFor(() => expect(result.current.paged!.total).toBe(60));
    let exported: Row[] = [];
    await act(async () => { exported = await result.current.paged!.exportAll(); });
    expect(urls().at(-1)).toBe('/api/things?pageSize=all&q=odd');
    expect(exported).toHaveLength(60);
  });
});

describe('usePagedList — after a save', () => {
  it('upsert replaces the row on screen at once and refreshes the page in the background', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    const before = urls().length;
    act(() => result.current.upsert({ id: 'r001', name: 'renamed' }));
    expect(result.current.rows.find((r) => r.id === 'r001')!.name).toBe('renamed');
    await waitFor(() => expect(urls()).toHaveLength(before + 1)); // even though the page was still fresh
  });

  it('remove takes the row off at once and refreshes the page', async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.remove('r000'));
    expect(result.current.rows.some((r) => r.id === 'r000')).toBe(false);
    await waitFor(() => expect(urls()).toHaveLength(2));
  });

  it('a page asked BEFORE a save but answered AFTER it is shown once but never remembered', async () => {
    const slow = deferred<ReturnType<typeof pagedResponse>>();
    get.mockReturnValueOnce(slow.promise);
    const { result } = hook();
    pagedCache.clear(); // a save finished while the request was in flight
    await act(async () => { slow.resolve(pagedResponse(all, '/api/things?page=1&pageSize=50')); });
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    expect(pagedCache.get(pagedUrl('/api/things', 1, 50, EMPTY_QUERY))).toBeUndefined();
  });

  it('a save (the api clears the remembered pages) makes the next visit ask the server again', async () => {
    const first = hook();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(50));
    first.unmount();
    pagedCache.clear(); // what api.post / put / delete do after every save
    const second = hook();
    await waitFor(() => expect(second.result.current.rows).toHaveLength(50));
    expect(urls()).toHaveLength(2);
  });
});

describe('pagedUrl — the key of a page', () => {
  it('the same query always gives the same URL (filters in a fixed order), so the memory is reused', () => {
    const a = pagedUrl('/api/x', 2, 25, { ...EMPTY_QUERY, filters: { b: '2', a: '1' } });
    const b = pagedUrl('/api/x', 2, 25, { ...EMPTY_QUERY, filters: { a: '1', b: '2' } });
    expect(a).toBe(b);
    expect(a).toBe('/api/x?page=2&pageSize=25&f.a=1&f.b=2');
  });
});
