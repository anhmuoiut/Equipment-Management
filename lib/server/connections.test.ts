import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const undici = vi.hoisted(() => ({
  setGlobalDispatcher: vi.fn(),
  Agent: vi.fn(function (this: { options: unknown }, options: unknown) { this.options = options; }),
}));
vi.mock('undici', () => undici);

import { KEEP_ALIVE_MS, keepConnectionsWarm } from './connections';

describe('keepConnectionsWarm', () => {
  it('installs one global agent that keeps idle connections far longer than the 4 s default', () => {
    keepConnectionsWarm();
    expect(undici.setGlobalDispatcher).toHaveBeenCalledTimes(1);
    const options = undici.Agent.mock.calls[0]![0] as { keepAliveTimeout: number; keepAliveMaxTimeout: number };
    expect(options.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(options.keepAliveTimeout).toBeGreaterThan(4_000);
    expect(options.keepAliveMaxTimeout).toBeGreaterThanOrEqual(options.keepAliveTimeout);
  });
});
