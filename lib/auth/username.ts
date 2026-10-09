/** Usernames are stored lowercase and matched exactly, independently of email. */
export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const username = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._+-]{0,63}$/.test(username) ? username : null;
}

/**
 * Phần sau @ của email nội bộ. Supabase Auth cần một email, nhưng người dùng chỉ biết username:
 * email này không gửi thư và không bao giờ hiện ra. Đừng dùng domain có hộp thư thật.
 */
export const INTERNAL_EMAIL_DOMAIN = 'jabil.local';

/** Username (đã chuẩn hóa) → email nội bộ trong Supabase Auth. */
export function usernameToEmail(username: string): string {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function safeLoginDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') ||
      /[\\\x00-\x1f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://app.local');
    return url.origin === 'https://app.local' && url.pathname !== '/login'
      ? url.pathname + url.search + url.hash : '/';
  } catch { return '/'; }
}
