import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), profile: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseAuthClient: async () => ({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } }),
}));
vi.mock('@/lib/services/profile', () => ({ getProfileIdentity: mocks.profile }));
import { loginWithUsername } from './login';

const profile = (is_active = true) =>
  ({ username: 'u', full_name: 'U', role: 'user', is_active, must_change_password: false });

let sequence = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signIn.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.profile.mockResolvedValue(profile());
});
function input(password = 'test-password') { return { username: 'test' + (++sequence), password }; }

describe('username sign-in (Supabase Auth only)', () => {
  it('maps the username to the internal email and returns nothing (no email, no token)', async () => {
    const credentials = input();
    expect(await loginWithUsername(credentials)).toBeUndefined();
    expect(mocks.signIn).toHaveBeenCalledWith({ email: `${credentials.username}@jabil.local`, password: 'test-password' });
    expect(mocks.profile).toHaveBeenCalledWith('user-1');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('normalizes username case before building the email', async () => {
    await loginWithUsername({ username: ' Man_Tran ', password: 'test' });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'man_tran@jabil.local', password: 'test' });
  });
  it('rejects a wrong password or unknown username with the same generic error', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, code: 'invalid_credentials' } });
    await expect(loginWithUsername(input())).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it('reports a locked account (Supabase ban) as USER_INACTIVE', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, code: 'user_banned' } });
    await expect(loginWithUsername(input())).rejects.toMatchObject({ code: 'USER_INACTIVE' });
  });
  it('passes the Supabase rate limit on as LOGIN_RATE_LIMITED', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 429, code: 'over_request_rate_limit' } });
    await expect(loginWithUsername(input())).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });
  it('signs out and refuses a profile that is locked in user_profiles (is_active = false)', async () => {
    mocks.profile.mockResolvedValue(profile(false));
    await expect(loginWithUsername(input())).rejects.toMatchObject({ code: 'USER_INACTIVE' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('signs out and gives nothing away when the Auth user has no profile', async () => {
    mocks.profile.mockResolvedValue(null);
    await expect(loginWithUsername(input())).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('rejects malformed input before calling Supabase', async () => {
    await expect(loginWithUsername({ username: '%', password: 'test' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(loginWithUsername({ username: 'user@example.com', password: 'test' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(loginWithUsername({ username: 'ok', password: '' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('limits repeated failed attempts for one username', async () => {
    const credentials = input();
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, code: 'invalid_credentials' } });
    for (let i = 0; i < 10; i++) {
      await expect(loginWithUsername(credentials)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(loginWithUsername(credentials)).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });
});
