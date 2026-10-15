import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

// The routes are thin: parse the URL, call the service, put the page in `data` and { total, page, pageSize } in `meta`.
vi.mock('@/lib/auth/withAuth', () => ({
  withAuth: (handler: (req: Request, ctx: unknown) => unknown) => (req: Request, routeCtx?: { params?: Record<string, string> }) =>
    handler(req, { requestId: 'req_test', profile: { id: 'u1', role: 'admin' }, params: routeCtx?.params ?? {} }),
  ok: (data: unknown, requestId: string, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { ...meta, request_id: requestId } }),
}));
const svc = vi.hoisted(() => ({ listEquipment: vi.fn(), listSubEquipment: vi.fn(), listGolden: vi.fn(), filterValues: vi.fn() }));
vi.mock('@/lib/services/equipment', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/services/equipment')>()), listEquipment: svc.listEquipment }));
vi.mock('@/lib/services/calibration', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/services/calibration')>()), listSubEquipment: svc.listSubEquipment }));
vi.mock('@/lib/services/golden', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/services/golden')>()), listGolden: svc.listGolden }));
vi.mock('@/lib/services/listFilters', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/services/listFilters')>()), filterValues: svc.filterValues }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no database in unit tests'); } }));

import { GET as equipmentGet } from './equipment/route';
import { GET as calibrationGet } from './calibration/route';
import { GET as goldenGet } from './golden/route';
import { GET as filterValuesGet } from './filter-values/[list]/route';

const call = (handler: unknown, url: string, params?: Record<string, string>) =>
  (handler as (req: Request, ctx?: unknown) => unknown)(new Request(`http://localhost${url}`), { params }) as Promise<{ data: unknown; meta: Record<string, unknown> }>;
const page = (rows: unknown[], total: number) => ({ rows, total, page: 2, pageSize: 25 });

beforeEach(() => { vi.resetAllMocks(); });

describe('list routes: one page in `data`, its position in `meta`', () => {
  it.each([
    ['/api/equipment', equipmentGet, svc.listEquipment],
    ['/api/calibration', calibrationGet, svc.listSubEquipment],
    ['/api/golden', goldenGet, svc.listGolden],
  ] as const)('%s', async (path, handler, service) => {
    service.mockResolvedValue(page([{ id: 'a' }], 120));
    const res = await call(handler, `${path}?page=2&pageSize=25&q=abc&sort=serial_number&dir=desc`);
    expect(res.data).toEqual([{ id: 'a' }]);
    expect(res.meta).toMatchObject({ total: 120, page: 2, pageSize: 25, request_id: 'req_test' });
    expect(service).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 25, q: 'abc', sort: 'serial_number', dir: 'desc' }));
  });

  it('with no parameters it asks for the first page of 50 — never everything', async () => {
    svc.listEquipment.mockResolvedValue(page([], 0));
    await call(equipmentGet, '/api/equipment');
    expect(svc.listEquipment).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50, q: '', sort: null, filters: {}, quick: null }));
  });

  it.each([
    ['/api/equipment?pageSize=5000', equipmentGet],
    ['/api/equipment?sort=password', equipmentGet],
    ['/api/calibration?quick=everything', calibrationGet],
    ['/api/golden?f.parent=', goldenGet],
    ['/api/calibration?f.status=maybe', calibrationGet],
  ] as const)('%s is refused as a validation error before any query', async (url, handler) => {
    await expect(call(handler, url)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(svc.listEquipment).not.toHaveBeenCalled();
    expect(svc.listSubEquipment).not.toHaveBeenCalled();
    expect(svc.listGolden).not.toHaveBeenCalled();
  });

  it('the calibration quick filters and the status filter are accepted; the golden board has no quick filter', async () => {
    svc.listSubEquipment.mockResolvedValue(page([], 0));
    await call(calibrationGet, '/api/calibration?quick=attention&f.status=overdue&f.result=__empty');
    expect(svc.listSubEquipment).toHaveBeenCalledWith(expect.objectContaining({ quick: 'attention', filters: { status: 'overdue', result: '__empty' } }));
    await expect(call(goldenGet, '/api/golden?quick=overdue')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('/api/filter-values/[list]', () => {
  it('returns the values for a known list', async () => {
    svc.filterValues.mockResolvedValue({ parent: ['T-1'] });
    const res = await call(filterValuesGet, '/api/filter-values/equipment', { list: 'equipment' });
    expect(res.data).toEqual({ parent: ['T-1'] });
    expect(svc.filterValues).toHaveBeenCalledWith('equipment');
  });

  it('an unknown list is not found', async () => {
    await expect(call(filterValuesGet, '/api/filter-values/users', { list: 'users' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
