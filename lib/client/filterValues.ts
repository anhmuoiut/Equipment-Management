'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { listCache, pagedCache } from '@/lib/client/cache';

export type FilterList = 'equipment' | 'calibration' | 'golden';
export type FilterValues = Record<string, string[]>;

/** Giá trị cho các bộ lọc cột lấy từ chính dữ liệu (serial của cha / tester, part number và origin của golden board) — /api/filter-values. */
const TTL_MS = 5 * 60_000;
type Entry = { at: number; epoch: number; values: FilterValues };

/**
 * Nhớ trong `listCache` (nên bị xóa khi đăng nhập / đăng xuất) và coi là cũ sau 5 phút HOẶC sau lần ghi nào của người dùng này (một tester
 * vừa có con thì phải hiện trong bộ lọc "Cha"). Chưa có: null — các bộ lọc khác vẫn dùng được, bộ lọc này tạm chỉ có "Tất cả".
 */
export function useFilterValues(list: FilterList): FilterValues | null {
  const key = `/api/filter-values/${list}`;
  const [values, setValues] = useState<FilterValues | null>(() => listCache.get<Entry>(key)?.values ?? null);
  useEffect(() => {
    // Đã nhớ và còn mới: giá trị ban đầu của state (lấy từ bộ nhớ) đã đủ — không gọi server.
    const hit = listCache.get<Entry>(key);
    if (hit && Date.now() - hit.at < TTL_MS && hit.epoch === pagedCache.epoch()) return;
    let current = true;
    const epoch = pagedCache.epoch();
    api.get<FilterValues>(key).then(({ data }) => {
      listCache.set(key, { at: Date.now(), epoch, values: data } satisfies Entry);
      if (current) setValues(data);
    }, () => { /* không tải được: bộ lọc này chỉ có "Tất cả"; lần mở sau thử lại */ });
    return () => { current = false; };
  }, [key]);
  return values;
}
