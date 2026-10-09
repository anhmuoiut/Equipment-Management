import { describe, expect, it } from 'vitest';
import { INTERNAL_EMAIL_DOMAIN, normalizeUsername, safeLoginDestination, usernameToEmail } from './username';
import { generateTempPassword } from './tempPassword';

describe('username and login redirects', () => {
  it('normalizes the existing admin username', () => {
    expect(normalizeUsername('  Academy.ManTranQP2507 ')).toBe('academy.mantranqp2507');
  });
  it.each(['user@example.com', '%', 'a b', '', 'a'.repeat(65), null])('rejects invalid usernames: %s', value => {
    expect(normalizeUsername(value)).toBeNull();
  });
  it('preserves underscores for exact username matching', () => {
    expect(normalizeUsername('Man_Tran')).toBe('man_tran');
  });
  it('accepts a purely numeric username (employee numbers)', () => {
    expect(normalizeUsername('2668118')).toBe('2668118');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/\n/evil.example'])('rejects unsafe return URLs: %s', value => {
    expect(safeLoginDestination(value)).toBe('/');
  });
  it('preserves a same-origin destination', () => {
    expect(safeLoginDestination('/?search=fixture')).toBe('/?search=fixture');
  });
});

describe('internal Supabase Auth email', () => {
  it('is <username>@jabil.local, and a username can never contain @ so two usernames never share an email', () => {
    expect(INTERNAL_EMAIL_DOMAIN).toBe('jabil.local');
    expect(usernameToEmail('man.tran')).toBe('man.tran@jabil.local');
    expect(normalizeUsername('a@jabil.local')).toBeNull();
  });
});

describe('temporary password', () => {
  it('is readable (Jabil-NNNN) and long enough for the 10-character password rule', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^Jabil-\d{4}$/);
      expect(p.length).toBeGreaterThanOrEqual(10);
    }
  });
});
