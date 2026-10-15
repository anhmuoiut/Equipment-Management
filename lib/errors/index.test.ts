import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, mapRpcError } from './index';

describe('mapRpcError — a database that is BEHIND the app gets its own, actionable error', () => {
  it.each([
    ['PGRST205', "Could not find the table 'public.equipment_list' in the schema cache"],
    ['PGRST202', 'Could not find the function public.dashboard_summary without parameters'],
    ['PGRST204', "Could not find the 'manufacturer' column of 'part_numbers' in the schema cache"],
    ['PGRST200', 'Could not find a relationship between tables'],
    ['42P01', 'relation "public.x" does not exist'],
    ['42883', 'function public.x() does not exist'],
    ['42703', 'column x does not exist'],
  ])('%s → DATABASE_OUT_OF_DATE (503), with the cause only in the diagnostic', (code, message) => {
    const e = mapRpcError({ code, message });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('DATABASE_OUT_OF_DATE');
    expect(e.status).toBe(503);
    expect(e.details).toEqual({}); // nothing from Postgres goes to the client
    expect(JSON.stringify(e.diagnostic)).toContain('database/migrations');
    expect(e.message).not.toContain('public.');
  });

  it('other database errors are unchanged: a raised code stays itself, SQLSTATEs map as before, the rest is SERVER_ERROR', () => {
    expect(mapRpcError({ message: 'EQUIPMENT_IN_USE', code: 'P0001' }).code).toBe('EQUIPMENT_IN_USE');
    expect(mapRpcError({ message: 'dup', code: '23505' }).code).toBe('DUPLICATE_VALUE');
    expect(mapRpcError({ message: 'boom', code: 'XX000' }).code).toBe('SERVER_ERROR');
    expect(mapRpcError(null).code).toBe('SERVER_ERROR');
  });

  it('is a server-side condition (status ≥ 500), so it is written to the error log like any other server error', () => {
    expect(ERROR_CODES.DATABASE_OUT_OF_DATE.status).toBeGreaterThanOrEqual(500);
  });
});
