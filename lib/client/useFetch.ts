'use client';

import { useCallback, useEffect, useReducer, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/client/api';
import { listCache } from '@/lib/client/cache';

/**
 * GET cho một vùng màn hình: dữ liệu, đang tải, lỗi (đã dịch), tải lại. Giữ
 * dữ liệu cũ khi tải lại / đổi bộ lọc; URL đổi hoặc vùng đóng thì bỏ qua phản
 * hồi cũ. `url = null`: chưa tải. Vùng chuyển sang bản ghi khác mà vẫn mở thì
 * đặt `key` theo id để không hiện dữ liệu của bản ghi trước.
 *
 * `cache: true` (danh sách của module): quay lại trang thì hiện ngay danh sách lần trước trong lúc tải bản mới (xem cache.ts);
 * `loading` vẫn bật cho tới khi bản mới về. Không dùng cho một bản ghi — chi tiết luôn phải là dữ liệu vừa tải.
 */
export function useFetch<T>(url: string | null, options: { cache?: boolean } = {}) {
  const { t } = useTranslation();
  const remember = !!options.cache;
  const [data, setRaw] = useState<T | null>(() => (remember && url ? listCache.get<T>(url) ?? null : null));
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(url !== null);
  const [version, reload] = useReducer((n: number) => n + 1, 0);

  // Sửa / thêm / xóa tại chỗ (setData) cũng cập nhật bản đã nhớ.
  const setData = useCallback((next: SetStateAction<T | null>) => {
    setRaw((previous) => {
      const value = typeof next === 'function' ? (next as (p: T | null) => T | null)(previous) : next;
      if (remember && url && value !== null) listCache.set(url, value);
      return value;
    });
  }, [remember, url]);

  useEffect(() => {
    if (url === null) { setLoading(false); return; }
    let current = true;
    const cached = remember ? listCache.get<T>(url) : undefined;
    if (cached !== undefined) setRaw(cached);
    setLoading(true);
    setError(null);
    api.get<T>(url)
      .then((r) => {
        if (remember) listCache.set(url, r.data);
        if (current) setRaw(r.data);
      }, (e: unknown) => { if (current) setError(e); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [url, version, remember]);

  return { data, setData, loading, error: error === null ? null : errorMessage(error, t), reload };
}
