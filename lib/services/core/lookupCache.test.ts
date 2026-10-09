import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { cachedLookups, invalidateLookups, LOOKUP_TABLES } from './lookupCache';

beforeEach(() => { vi.useFakeTimers(); invalidateLookups(); });
afterEach(() => { vi.useRealTimers(); });

describe('lookups cache', () => {
  it('reads once and serves later calls from memory', async () => {
    const read = vi.fn().mockResolvedValue({ n: 1 });
    expect(await cachedLookups(read)).toEqual({ n: 1 });
    expect(await cachedLookups(read)).toEqual({ n: 1 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('requests that overlap share ONE read', async () => {
    let finish!: (v: string) => void;
    const read = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const a = cachedLookups(read);
    const b = cachedLookups(read);
    finish('rows');
    expect(await Promise.all([a, b])).toEqual(['rows', 'rows']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('expires after a minute, so edits made outside the app show up', async () => {
    const read = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    expect(await cachedLookups(read)).toBe('old');
    vi.advanceTimersByTime(59_000);
    expect(await cachedLookups(read)).toBe('old');
    vi.advanceTimersByTime(2_000);
    expect(await cachedLookups(read)).toBe('new');
  });

  it('a write (invalidate) makes the next read fetch fresh data', async () => {
    const read = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after');
    expect(await cachedLookups(read)).toBe('before');
    invalidateLookups();
    expect(await cachedLookups(read)).toBe('after');
  });

  it('a read that STARTED before a write is never reused by later requests', async () => {
    let finishOld!: (v: string) => void;
    const old = cachedLookups(() => new Promise<string>((resolve) => { finishOld = resolve; }));
    invalidateLookups(); // the write lands while the old read is still running
    const fresh = vi.fn().mockResolvedValue('fresh');
    expect(await cachedLookups(fresh)).toBe('fresh');
    finishOld('stale');
    expect(await old).toBe('stale'); // its own callers still get what they asked for…
    expect(await cachedLookups(vi.fn())).toBe('fresh'); // …but nobody else is served it
  });

  it('does not remember a failure: the next call reads again', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(cachedLookups(read)).rejects.toThrow('boom');
    expect(await cachedLookups(read)).toBe('ok');
  });

  it('covers every table the lookups read', () => {
    expect([...LOOKUP_TABLES].sort()).toEqual([
      'calibration_vendors', 'departments', 'levels', 'locations', 'part_numbers', 'tags', 'type_groups', 'types', 'user_profiles',
    ]);
  });
});
