// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client/api')>()), api: { get } }));

import { listCache } from './cache';
import { useFetch } from './useFetch';

type Row = { id: string; n: number };
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => { get.mockReset(); });

describe('useFetch', () => {
  it('without cache: loads, and a second mount starts empty again (a record is never shown from memory)', async () => {
    get.mockResolvedValue({ data: { id: 'a', n: 1 }, meta: {} });
    const first = renderHook(() => useFetch<Row>('/api/things/a'));
    await waitFor(() => expect(first.result.current.data).toEqual({ id: 'a', n: 1 }));
    first.unmount();
    const hold = deferred<{ data: Row; meta: object }>();
    get.mockReturnValue(hold.promise);
    const second = renderHook(() => useFetch<Row>('/api/things/a'));
    expect(second.result.current.data).toBeNull();
    expect(second.result.current.loading).toBe(true);
  });

  it('with cache: the second visit shows the last list at once while the new one loads, then swaps', async () => {
    get.mockResolvedValue({ data: [{ id: 'a', n: 1 }], meta: {} });
    const first = renderHook(() => useFetch<Row[]>('/api/things', { cache: true }));
    await waitFor(() => expect(first.result.current.data).toEqual([{ id: 'a', n: 1 }]));
    first.unmount();

    const hold = deferred<{ data: Row[]; meta: object }>();
    get.mockReturnValue(hold.promise);
    const second = renderHook(() => useFetch<Row[]>('/api/things', { cache: true }));
    expect(second.result.current.data).toEqual([{ id: 'a', n: 1 }]); // instantly
    expect(second.result.current.loading).toBe(true); // …and still refreshing
    await act(async () => { hold.resolve({ data: [{ id: 'a', n: 2 }], meta: {} }); });
    expect(second.result.current.data).toEqual([{ id: 'a', n: 2 }]);
    expect(second.result.current.loading).toBe(false);
    expect(listCache.get('/api/things')).toEqual([{ id: 'a', n: 2 }]); // the next visit starts from the fresh one
  });

  it('with cache: edits made in place (upsert / remove) are remembered too', async () => {
    get.mockResolvedValue({ data: [{ id: 'a', n: 1 }], meta: {} });
    const view = renderHook(() => useFetch<Row[]>('/api/things', { cache: true }));
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    act(() => { view.result.current.setData((rows) => [...(rows ?? []), { id: 'b', n: 2 }]); });
    expect(listCache.get('/api/things')).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  });

  it('a failed refresh keeps the remembered list on screen and reports the error', async () => {
    listCache.set('/api/things', [{ id: 'a', n: 1 }]);
    get.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderHook(() => useFetch<Row[]>('/api/things', { cache: true }));
    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.data).toEqual([{ id: 'a', n: 1 }]);
  });
});
