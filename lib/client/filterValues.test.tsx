// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client/api')>()), api: { get } }));

import { listCache, pagedCache } from './cache';
import { useFilterValues } from './filterValues';

beforeEach(() => { get.mockReset(); listCache.clear(); pagedCache.clear(); });

describe('useFilterValues', () => {
  it('loads the values once for the screen and remembers them for the next visit', async () => {
    get.mockResolvedValue({ data: { parent: ['T-1'] }, meta: {} });
    const first = renderHook(() => useFilterValues('equipment'));
    expect(first.result.current).toBeNull();
    await waitFor(() => expect(first.result.current).toEqual({ parent: ['T-1'] }));
    first.unmount();
    const second = renderHook(() => useFilterValues('equipment'));
    expect(second.result.current).toEqual({ parent: ['T-1'] }); // at once
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/filter-values/equipment');
  });

  it('asks again after a save of this user (a tester that just got a child must show up)', async () => {
    get.mockResolvedValue({ data: { parent: ['T-1'] }, meta: {} });
    const first = renderHook(() => useFilterValues('equipment'));
    await waitFor(() => expect(first.result.current).not.toBeNull());
    first.unmount();
    pagedCache.clear(); // what every save does
    get.mockResolvedValue({ data: { parent: ['T-1', 'T-2'] }, meta: {} });
    const second = renderHook(() => useFilterValues('equipment'));
    await waitFor(() => expect(second.result.current).toEqual({ parent: ['T-1', 'T-2'] }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('each screen has its own values', async () => {
    get.mockImplementation(async (url: string) => ({ data: { for: [url] }, meta: {} }));
    const a = renderHook(() => useFilterValues('golden'));
    const b = renderHook(() => useFilterValues('calibration'));
    await waitFor(() => expect(a.result.current).toEqual({ for: ['/api/filter-values/golden'] }));
    await waitFor(() => expect(b.result.current).toEqual({ for: ['/api/filter-values/calibration'] }));
  });

  it('when it cannot be loaded the filter just has no extra choices (null), and nothing is thrown', async () => {
    get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFilterValues('equipment'));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
