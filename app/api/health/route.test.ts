import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ limit: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/services/core/db', () => ({ db: () => ({ from: () => ({ select: () => ({ limit: m.limit }) }) }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ insert: m.insert }) }) }));

import { NextRequest } from 'next/server';

const call = async () => {
  const { GET } = await import('./route');
  return GET(new NextRequest('http://localhost/api/health'), { params: Promise.resolve({}) });
};

describe('GET /api/health (keepalive)', () => {
  beforeEach(() => {
    vi.resetModules();
    m.limit.mockReset().mockResolvedValue({ data: [{ id: 't' }], error: null });
    m.insert.mockReset().mockResolvedValue({ error: null });
  });

  it('answers 200 without signing in and really reads the database', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.ok).toBe(true);
    expect(m.limit).toHaveBeenCalledTimes(1);
  });

  it('reads the database at most once a minute per instance', async () => {
    const { GET } = await import('./route');
    for (let i = 0; i < 3; i++) await GET(new NextRequest('http://localhost/api/health'), { params: Promise.resolve({}) });
    expect(m.limit).toHaveBeenCalledTimes(1);
  });

  it('answers 500 (so the workflow turns red) when the database cannot be read, and says nothing about why', async () => {
    m.limit.mockResolvedValue({ data: null, error: { code: 'PGRST000', message: 'secret internal detail' } });
    const res = await call();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret internal detail');
  });
});
