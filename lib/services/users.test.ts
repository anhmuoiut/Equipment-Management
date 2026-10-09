import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({
  appWrite: vi.fn(), selectOne: vi.fn(), selectAll: vi.fn(),
  taken: vi.fn(), createUser: vi.fn(), updateUserById: vi.fn(), deleteUser: vi.fn(),
}));
vi.mock('./core/db', () => ({
  appWrite: m.appWrite, selectOne: m.selectOne, selectAll: m.selectAll,
  db: () => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: m.taken }) }) }),
    auth: { admin: { createUser: m.createUser, updateUserById: m.updateUserById, deleteUser: m.deleteUser } },
  }),
}));
vi.mock('./core/lookups', () => ({
  loadLookups: async () => ({ departments: new Map([['d1', { id: 'd1', display_name: 'TE', sort_order: 1, is_active: true }]]), users: new Map() }),
  assertActive: () => undefined,
  nameOf: (map: Map<string, { display_name: string }>, id: string | null) => (id ? map.get(id)?.display_name ?? null : null),
  auditOf: (_l: unknown, r: Record<string, unknown>) => ({ ...r, created_by_name: null, updated_by_name: null }),
}));
vi.mock('./core/history', () => ({ readHistory: vi.fn() }));
import { AppError } from '@/lib/errors';
import { createUser, resetUserPassword, setUserActive, updateUser } from './users';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'u1', username: 'ann', full_name: 'Ann', employee_id: null, department_id: null, role: 'user', is_active: true,
  must_change_password: false, created_at: '2026-01-01', created_by: null, updated_at: '2026-01-01', updated_by: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.selectOne.mockResolvedValue(row());
  m.taken.mockResolvedValue({ data: [], error: null });
  m.createUser.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });
  m.updateUserById.mockResolvedValue({ error: null });
  m.deleteUser.mockResolvedValue({ error: null });
  m.appWrite.mockResolvedValue({});
});

describe('createUser', () => {
  it('creates the Auth user with the internal email and a readable temp password, then the profile with the same id', async () => {
    m.selectOne.mockResolvedValue(row({ id: 'auth-1', username: 'ann.tran', must_change_password: true }));
    const result = await createUser({ username: ' Ann.Tran ', full_name: 'Ann', role: 'readonly' }, 'admin-1');

    const call = m.createUser.mock.calls[0]![0];
    expect(call).toMatchObject({ email: 'ann.tran@jabil.local', email_confirm: true });
    expect(call.password).toMatch(/^Jabil-\d{4}$/);
    expect(result.temp_password).toBe(call.password);

    const [table, op, id, data, actor] = m.appWrite.mock.calls[0]!;
    expect([table, op, id, actor]).toEqual(['user_profiles', 'insert', null, 'admin-1']);
    expect(data).toMatchObject({ id: 'auth-1', username: 'ann.tran', role: 'readonly', is_active: true, must_change_password: true });
    expect(data).not.toHaveProperty('password');
  });
  it('refuses a taken username without creating anything in Auth', async () => {
    m.taken.mockResolvedValue({ data: [{ id: 'x' }], error: null });
    await expect(createUser({ username: 'ann', full_name: 'A', role: 'user' }, 'a')).rejects.toMatchObject({ code: 'USERNAME_ALREADY_EXISTS' });
    expect(m.createUser).not.toHaveBeenCalled();
  });
  it('reports an Auth email that already exists as a taken username', async () => {
    m.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'exists' } });
    await expect(createUser({ username: 'ann', full_name: 'A', role: 'user' }, 'a')).rejects.toMatchObject({ code: 'USERNAME_ALREADY_EXISTS' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });
  it('rejects an invalid username before touching anything', async () => {
    await expect(createUser({ username: 'a@b.c', full_name: 'A', role: 'user' }, 'a')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.taken).not.toHaveBeenCalled();
    expect(m.createUser).not.toHaveBeenCalled();
  });
  it('removes the Auth user again when the profile cannot be written (no orphan accounts)', async () => {
    m.appWrite.mockRejectedValue(new AppError('SERVER_ERROR'));
    await expect(createUser({ username: 'ann', full_name: 'A', role: 'user' }, 'a')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(m.deleteUser).toHaveBeenCalledWith('auth-1');
  });
  it('turns a unique violation on the profile into USERNAME_ALREADY_EXISTS (and still cleans up)', async () => {
    m.appWrite.mockRejectedValue(new AppError('DUPLICATE_VALUE'));
    await expect(createUser({ username: 'ann', full_name: 'A', role: 'user' }, 'a')).rejects.toMatchObject({ code: 'USERNAME_ALREADY_EXISTS' });
    expect(m.deleteUser).toHaveBeenCalledWith('auth-1');
  });
});

describe('updateUser', () => {
  it('writes the role first (it can be refused) and the profile fields second, as two history rows', async () => {
    await updateUser('u1', { role: 'admin', full_name: 'Ann B' }, 'admin-1');
    expect(m.appWrite.mock.calls.map((c) => c[3])).toEqual([{ role: 'admin' }, { full_name: 'Ann B' }]);
  });
  it('writes nothing for fields that did not change', async () => {
    await updateUser('u1', { role: 'user', full_name: 'Ann' }, 'admin-1');
    expect(m.appWrite).not.toHaveBeenCalled();
  });
  it('does not write the profile when the database refuses the role change (LAST_ADMIN)', async () => {
    m.appWrite.mockRejectedValueOnce(new AppError('LAST_ADMIN'));
    await expect(updateUser('u1', { role: 'readonly', full_name: 'Ann B' }, 'admin-1')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(m.appWrite).toHaveBeenCalledTimes(1);
  });
  it('is NOT_FOUND for an unknown account', async () => {
    m.selectOne.mockResolvedValue(null);
    await expect(updateUser('nope', { full_name: 'X' }, 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('setUserActive (lock / unlock)', () => {
  it('lock: updates user_profiles first (database guards run), then bans in Auth', async () => {
    await setUserActive('u1', false, 'admin-1');
    expect(m.appWrite).toHaveBeenCalledWith('user_profiles', 'update', 'u1', { is_active: false }, 'admin-1');
    expect(m.updateUserById).toHaveBeenCalledWith('u1', { ban_duration: '876000h' });
    expect(m.appWrite.mock.invocationCallOrder[0]).toBeLessThan(m.updateUserById.mock.invocationCallOrder[0]!);
  });
  it('lock: when the database refuses (ADMIN_SELF_CHANGE / LAST_ADMIN) nothing is banned', async () => {
    m.appWrite.mockRejectedValue(new AppError('LAST_ADMIN'));
    await expect(setUserActive('u1', false, 'admin-1')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
  it('lock: if the ban fails the profile is put back, so the admin sees an error instead of a half-locked account', async () => {
    m.updateUserById.mockResolvedValue({ error: { message: 'boom' } });
    await expect(setUserActive('u1', false, 'admin-1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(m.appWrite.mock.calls.map((c) => c[3])).toEqual([{ is_active: false }, { is_active: true }]);
  });
  it('unlock: lifts the ban first, then sets is_active', async () => {
    m.selectOne.mockResolvedValue(row({ is_active: false }));
    await setUserActive('u1', true, 'admin-1');
    expect(m.updateUserById).toHaveBeenCalledWith('u1', { ban_duration: 'none' });
    expect(m.appWrite).toHaveBeenCalledWith('user_profiles', 'update', 'u1', { is_active: true }, 'admin-1');
    expect(m.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(m.appWrite.mock.invocationCallOrder[0]!);
  });
  it('unlock: if lifting the ban fails the profile stays locked', async () => {
    m.selectOne.mockResolvedValue(row({ is_active: false }));
    m.updateUserById.mockResolvedValue({ error: { message: 'boom' } });
    await expect(setUserActive('u1', true, 'admin-1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });
  it('refuses a no-op', async () => {
    await expect(setUserActive('u1', true, 'admin-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('resetUserPassword', () => {
  it('sets a new readable temp password in Auth, then flags must_change_password with action PASSWORD_RESET', async () => {
    const result = await resetUserPassword('u1', 'admin-1');
    const { password } = m.updateUserById.mock.calls[0]![1];
    expect(password).toMatch(/^Jabil-\d{4}$/);
    expect(result.temp_password).toBe(password);
    expect(m.appWrite).toHaveBeenCalledWith('user_profiles', 'update', 'u1', { must_change_password: true }, 'admin-1', { action: 'PASSWORD_RESET' });
  });
  it('works for a locked account too', async () => {
    m.selectOne.mockResolvedValue(row({ is_active: false }));
    await expect(resetUserPassword('u1', 'admin-1')).resolves.toMatchObject({ temp_password: expect.stringMatching(/^Jabil-\d{4}$/) });
  });
  it('is refused for the admin themself (they change their own password in the account menu)', async () => {
    await expect(resetUserPassword('admin-1', 'admin-1')).rejects.toMatchObject({ code: 'ADMIN_SELF_CHANGE' });
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
  it('does not flag the profile if Auth refuses the new password', async () => {
    m.updateUserById.mockResolvedValue({ error: { message: 'weak' } });
    await expect(resetUserPassword('u1', 'admin-1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });
});
