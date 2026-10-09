'use client';

import { useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export type UrlChanges = Record<string, string | null>;

/**
 * Tham số trên URL (`?id=`, `?new=1`, `?tool=`) là nguồn sự thật của modal đang mở
 * (docs/DETAIL_MODEL.md 3.9). Đổi bằng `history.pushState` / `replaceState` — Next.js nối chúng vào
 * `useSearchParams`, nên modal mở / đóng ngay, không chờ server trả lại trang.
 * `push`: mở từ danh sách (nút Back của trình duyệt đóng modal); `replace`: chuyển bản ghi / màn hình.
 */
export function useUrlParams() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const update = useCallback((changes: UrlChanges, mode: 'push' | 'replace' = 'replace') => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);

  const back = useCallback(() => window.history.back(), []);

  return { searchParams, pathname, update, back };
}
