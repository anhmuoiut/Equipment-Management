import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ profile: vi.fn(), verify: vi.fn(), updateUserById: vi.fn(), appWrite: vi.fn() }));
vi.mock('./core/db', () => ({
  appWrite: m.appWrite,
  db: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.profile }) }) }),
    auth: { admin: { updateUserById: m.updateUserById } },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseStatelessAuthClient: () => ({ auth: { signInWithPassword: m.verify } }),
}));
import { changeOwnPassword } from './account';

beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockResolvedValue({ data: { username: 'ann' }, error: null });
  m.verify.mockResolvedValue({ error: null });
  m.updateUserById.mockResolvedValue({ error: null });
  m.appWrite.mockResolvedValue({});
});

describe('changeOwnPassword', () => {
  it('checks the current (or temporary) password against the internal email without touching the session', async () => {
    await changeOwnPassword('u1', 'Jabil-1234', 'my-own-password');
    expect(m.verify).toHaveBeenCalledWith({ email: 'ann@jabil.local', password: 'Jabil-1234' });
  });
  it('sets the new password in Auth, then clears must_change_password as the user themself (no history row)', async () => {
    await changeOwnPassword('u1', 'Jabil-1234', 'my-own-password');
    expect(m.updateUserById).toHaveBeenCalledWith('u1', { password: 'my-own-password' });
    expect(m.appWrite).toHaveBeenCalledWith('user_profiles', 'update', 'u1', { must_change_password: false }, 'u1');
  });
  it('rejects a wrong current password and changes nothing', async () => {
    m.verify.mockResolvedValue({ error: { status: 400, code: 'invalid_credentials' } });
    await expect(changeOwnPassword('u1', 'bad', 'my-own-password')).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INCORRECT' });
    expect(m.updateUserById).not.toHaveBeenCalled();
    expect(m.appWrite).not.toHaveBeenCalled();
  });
  it('rejects a new password equal to the current one', async () => {
    await expect(changeOwnPassword('u1', 'same-password-1', 'same-password-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
  it('keeps must_change_password when Auth refuses the new password', async () => {
    m.updateUserById.mockResolvedValue({ error: { message: 'weak password' } });
    await expect(changeOwnPassword('u1', 'Jabil-1234', 'my-own-password')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(m.appWrite).not.toHaveBeenCalled();
  });
  it('passes the Supabase rate limit on', async () => {
    m.verify.mockResolvedValue({ error: { status: 429, code: 'over_request_rate_limit' } });
    await expect(changeOwnPassword('u1', 'x', 'my-own-password')).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });
});
