import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), profile: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseAuthClient: async () => ({ auth: { getSession: m.getSession, getUser: m.getUser } }) }));
vi.mock('@/lib/services/profile', () => ({ getProfileIdentity: m.profile }));
import { getCaller } from './session';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const token = (sub: unknown) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
const identity = (name: string) => ({ username: name, full_name: name, role: 'user', is_active: true, must_change_password: false });

beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue({ data: { session: { access_token: token(ME) } } });
  m.getUser.mockResolvedValue({ data: { user: { id: ME } } });
  m.profile.mockResolvedValue(identity('me'));
});

describe('getCaller', () => {
  it('returns the verified user with the profile (id included)', async () => {
    expect(await getCaller()).toEqual({ userId: ME, profile: { id: ME, ...identity('me') } });
  });

  it('reads the profile WHILE Supabase verifies the token, not after it', async () => {
    const order: string[] = [];
    m.getUser.mockImplementation(async () => { order.push('getUser:start'); await Promise.resolve(); order.push('getUser:end'); return { data: { user: { id: ME } } }; });
    m.profile.mockImplementation(async () => { order.push('profile:start'); return identity('me'); });
    await getCaller();
    expect(order.slice(0, 2).sort()).toEqual(['getUser:start', 'profile:start']); // both started before either finished
    expect(m.profile).toHaveBeenCalledTimes(1);
  });

  it('no session → null, and no profile is read', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } });
    m.getUser.mockResolvedValue({ data: { user: null } });
    expect(await getCaller()).toBeNull();
    expect(m.profile).not.toHaveBeenCalled();
  });

  it('a forged token naming someone else: Supabase refuses it → null (the early profile is thrown away)', async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: token(OTHER) } } });
    m.getUser.mockResolvedValue({ data: { user: null } });
    expect(await getCaller()).toBeNull();
  });

  it('the token hint differs from the verified user → the verified user\'s own profile is read, never the hinted one', async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: token(OTHER) } } });
    m.profile.mockImplementation(async (id: string) => identity(id === ME ? 'me' : 'someone-else'));
    expect(await getCaller()).toEqual({ userId: ME, profile: { id: ME, ...identity('me') } });
  });

  it('garbage in the cookie (not a JWT / not a uuid) is ignored, not a crash and not a database error', async () => {
    for (const bad of [undefined, 'nope', token('not-a-uuid'), token(42), 'a.@@@.c']) {
      m.getSession.mockResolvedValue({ data: { session: bad === undefined ? null : { access_token: bad } } });
      m.profile.mockClear();
      await expect(getCaller()).resolves.toMatchObject({ userId: ME });
      expect(m.profile).toHaveBeenCalledTimes(1); // only the verified id was looked up
      expect(m.profile).toHaveBeenCalledWith(ME);
    }
  });

  it('a failing early read does not fail the request: the profile is read again for the verified user', async () => {
    m.profile.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(identity('me'));
    expect(await getCaller()).toEqual({ userId: ME, profile: { id: ME, ...identity('me') } });
    expect(m.profile).toHaveBeenCalledTimes(2);
  });

  it('a real profile failure still surfaces (the second read throws)', async () => {
    m.profile.mockRejectedValue(new Error('database down'));
    await expect(getCaller()).rejects.toThrow('database down');
  });

  it('a valid session without a profile row → profile null (callers answer UNAUTHORIZED)', async () => {
    m.profile.mockResolvedValue(null);
    expect(await getCaller()).toEqual({ userId: ME, profile: null });
  });
});
