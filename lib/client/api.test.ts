import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@/lib/errors';
import en from '@/src/i18n/locales/en.json';
import vi_ from '@/src/i18n/locales/vi.json';
import { api, ApiError, errorMessage } from './api';

/** Mã lỗi chỉ sinh ra ở client (lib/client/api.ts). */
const CLIENT_CODES = ['NETWORK_ERROR', 'TIMEOUT', 'CONFLICT', 'PAYLOAD_TOO_LARGE', 'UNKNOWN_ERROR'];

const errors = en.errors as Record<string, string>;
/** t() tối giản đọc en.json › errors, giống i18next (defaultValue khi thiếu khóa). */
const t = (key: string, options?: Record<string, unknown>) =>
  errors[key.replace(/^errors\./, '')] ?? (options?.defaultValue as string | undefined) ?? key;

function respond(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('error messages', () => {
  it('every error code has English and Vietnamese text', () => {
    for (const code of [...Object.keys(ERROR_CODES), ...CLIENT_CODES]) {
      expect(en.errors, code).toHaveProperty(code);
      expect(vi_.errors, code).toHaveProperty(code);
    }
  });

  it('uses the server code, falls back by HTTP status, and adds the request id to server errors', () => {
    expect(errorMessage(new ApiError('USER_INACTIVE', 'x', {}, 'req_1', 403), t)).toBe(errors.USER_INACTIVE);
    expect(errorMessage(new ApiError('SOMETHING_NEW', 'x', {}, 'req_1', 404), t)).toBe(errors.NOT_FOUND);
    expect(errorMessage(new ApiError('SERVER_ERROR', 'x', {}, 'req_9', 500), t)).toBe(`${errors.SERVER_ERROR} (req_9)`);
  });

  it('never shows a raw exception', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(errorMessage(new TypeError('x is undefined'), t)).toBe(errors.UNKNOWN_ERROR);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('api client', () => {
  it('turns a failed connection into NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = await failure(api.get('/api/equipment'));
    expect([e.code, e.status]).toEqual(['NETWORK_ERROR', 0]);
  });

  it('turns a timeout into TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    expect((await failure(api.get('/api/equipment'))).code).toBe('TIMEOUT');
  });

  it('keeps the server error code, details and request id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid data.', details: { fields: { serial_number: 'required' } }, request_id: 'req_7' },
    })));
    const e = await failure(api.post('/api/equipment', {}));
    expect([e.code, e.requestId, e.status]).toEqual(['VALIDATION_ERROR', 'req_7', 400]);
    expect(e.fieldErrors).toEqual({ serial_number: 'required' });
  });

  it('maps a non-JSON response (proxy / platform page) by HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(502, '<html>Bad gateway</html>')));
    expect((await failure(api.get('/api/equipment'))).code).toBe('SERVER_ERROR');
    vi.stubGlobal('fetch', vi.fn(async () => respond(413, 'Request Entity Too Large')));
    expect((await failure(api.upload('/api/equipment/import', new FormData()))).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns data and meta on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { success: true, data: [1], meta: { duplicate: true } })));
    expect(await api.get('/api/x')).toEqual({ data: [1], meta: { duplicate: true } });
  });

  it('sends an ended session to sign-in once, but not for a wrong password on the sign-in form', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const unauthorized = () => respond(401, { success: false, error: { code: 'UNAUTHORIZED', message: '', details: {}, request_id: 'r' } });
    vi.stubGlobal('fetch', vi.fn(async () => respond(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: '', details: {}, request_id: 'r' } })));
    await failure(api.post('/api/auth/login', {}));
    expect(assign).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));
    await failure(api.get('/api/dashboard'));
    await failure(api.get('/api/equipment'));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/api/auth/session-ended');
  });
});

describe('GET sharing', () => {
  const ok = (data: unknown) => respond(200, { success: true, data, meta: {} });

  it('overlapping GETs of one URL (React StrictMode runs every effect twice) are ONE request; later ones go out again', async () => {
    const fetchMock = vi.fn(async () => ok([1]));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([api.get('/api/same'), api.get('/api/same')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await api.get('/api/same');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('different URLs are different requests', async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([api.get('/api/one'), api.get('/api/two')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a GET made after a save never receives the answer of a GET that was already in the air before it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return ok({ saved: true });
      const mine = ++reads;
      if (mine === 1) await gate; // the old read is slow, and was sent before the save
      return ok(mine === 1 ? 'before-save' : 'after-save');
    }));
    const old = api.get('/api/list');
    await api.post('/api/things', {});
    const fresh = api.get('/api/list'); // must NOT join `old`
    release();
    expect((await fresh).data).toBe('after-save');
    expect((await old).data).toBe('before-save');
  });

  it('a failure is shared by the callers waiting on it and is not remembered', async () => {
    const fetchMock = vi.fn(async () => respond(500, { success: false, error: { code: 'SERVER_ERROR', message: '', details: {}, request_id: 'r' } }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([failure(api.get('/api/bad')), failure(api.get('/api/bad'))]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => ok('fine')));
    expect((await api.get('/api/bad')).data).toBe('fine');
  });
});

describe('remembered pages (paged lists)', () => {
  const page = { total: 1, page: 1, pageSize: 50 };

  it('are forgotten after every save — a Swap, Move, edit or import can change any row on any page', async () => {
    const { pagedCache } = await import('./cache');
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { success: true, data: {}, meta: {} })));
    for (const save of [() => api.post('/api/equipment', {}), () => api.put('/api/equipment/e1', {}), () => api.delete('/api/equipment/e1')]) {
      pagedCache.set('/api/equipment?page=1&pageSize=50', [{ id: 'a' }], page);
      await save();
      expect(pagedCache.get('/api/equipment?page=1&pageSize=50')).toBeUndefined();
    }
  });

  it('are forgotten also when the save FAILS (a multi-step action may have changed some rows before it stopped)', async () => {
    const { pagedCache } = await import('./cache');
    vi.stubGlobal('fetch', vi.fn(async () => respond(500, { success: false, error: { code: 'SERVER_ERROR', message: '', details: {}, request_id: 'r' } })));
    pagedCache.set('/api/equipment?page=1&pageSize=50', [{ id: 'a' }], page);
    await failure(api.post('/api/assets/equipment/swap', {}));
    expect(pagedCache.get('/api/equipment?page=1&pageSize=50')).toBeUndefined();
  });

  it('are forgotten on sign-in and sign-out, and reading a page never clears anything', async () => {
    const { pagedCache } = await import('./cache');
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { success: true, data: [], meta: {} })));
    pagedCache.set('/api/equipment?page=1&pageSize=50', [{ id: 'a' }], page);
    await api.get('/api/equipment?page=2&pageSize=50');
    expect(pagedCache.get('/api/equipment?page=1&pageSize=50')).toBeDefined();
    for (const path of ['/api/auth/login', '/api/auth/logout']) {
      pagedCache.set('/api/equipment?page=1&pageSize=50', [{ id: 'a' }], page);
      await api.post(path, {});
      expect(pagedCache.get('/api/equipment?page=1&pageSize=50')).toBeUndefined();
    }
  });

  it('a page is fresh for 30 seconds, then used only as a placeholder; the cache keeps at most 60 pages', async () => {
    const { pagedCache, STALE_MS } = await import('./cache');
    pagedCache.clear();
    pagedCache.set('k', [], page);
    expect(pagedCache.fresh(pagedCache.get('k'))).toBe(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + STALE_MS + 1);
    expect(pagedCache.fresh(pagedCache.get('k'))).toBe(false);
    vi.useRealTimers();
    for (let i = 0; i < 80; i++) pagedCache.set(`p${i}`, [], page);
    expect(pagedCache.get('p0')).toBeUndefined(); // the oldest were dropped
    expect(pagedCache.get('p79')).toBeDefined();
    pagedCache.clear();
  });
});

describe('remembered lists', () => {
  it('are forgotten on sign-in and sign-out — the next account must not see the previous one\'s lists', async () => {
    const { listCache } = await import('./cache');
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { success: true, data: {}, meta: {} })));
    for (const path of ['/api/auth/login', '/api/auth/logout']) {
      listCache.set('/api/users', [{ id: 'u' }]);
      await api.post(path, {});
      expect(listCache.get('/api/users')).toBeUndefined();
    }
    listCache.set('/api/users', [{ id: 'u' }]);
    await api.post('/api/equipment', {}); // an ordinary save keeps them
    expect(listCache.get('/api/users')).toBeDefined();
  });
});
