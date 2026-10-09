/**
 * Thay `useUrlParams` trong test: URL là một biến trong bộ nhớ, đổi thì component vẽ lại — giống Next.js nối
 * history.pushState / replaceState vào useSearchParams. Dùng: `vi.mock('@/lib/client/useUrlParams', () => import('@/lib/client/testing/urlParamsMock'))`.
 */
import { useSyncExternalStore } from 'react';

let search = '';
const history: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Đặt lại URL về `initial` (ví dụ `id=abc`) và xóa lịch sử — gọi ở beforeEach. */
export function resetUrl(initial = ''): void {
  search = initial;
  history.length = 0;
  emit();
}

export const currentSearch = () => search;
export const historyDepth = () => history.length;

function update(changes: Record<string, string | null>, mode: 'push' | 'replace' = 'replace'): void {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  if (mode === 'push') history.push(search);
  search = params.toString();
  emit();
}

function back(): void {
  search = history.pop() ?? '';
  emit();
}

export function useUrlParams() {
  const current = useSyncExternalStore(subscribe, () => search, () => search);
  return { searchParams: new URLSearchParams(current), pathname: '/x', update, back };
}
