'use client';

/**
 * Danh sách chọn dùng chung (Part Number, Location, Type, Tag, …) — tải
 * một lần, dùng lại cho mọi form; refreshOptions() sau khi Configuration đổi.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/client/api';
import { toast } from '@/components/ui';
import type { SelectOption } from '@/components/ui/SearchableSelect';
import type { OptionItem, Options } from '@/lib/types';

let cache: Options | null = null;
let inflight: Promise<Options> | null = null;
const listeners = new Set<(o: Options) => void>();

function load(force = false): Promise<Options> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = api.get<Options>('/api/options').then((r) => {
    cache = r.data;
    inflight = null;
    listeners.forEach((l) => l(r.data));
    return r.data;
  }).catch((e) => { inflight = null; throw e; });
  return inflight;
}

/**
 * Danh sách chọn do server đưa sẵn trong layout (`(app)/layout.tsx`): form đầu tiên khỏi phải gọi `/api/options` (2 lần xác thực
 * cho 0 lần đọc dữ liệu). Chỉ đặt khi chưa có gì — không bao giờ ghi đè bản mới hơn của `refreshOptions()`.
 */
export function seedOptions(initial: Options): void {
  if (cache) return;
  cache = initial;
  listeners.forEach((l) => l(initial));
}

/** Sau khi Configuration đổi dữ liệu gốc: tải lại danh sách chọn cho mọi form. Lỗi → chỗ gọi báo. */
export async function refreshOptions(): Promise<void> {
  await load(true);
}

export function useOptions(): Options | null {
  const { t } = useTranslation();
  const [options, setOptions] = useState<Options | null>(cache);
  useEffect(() => {
    listeners.add(setOptions);
    // Không tải được → các ô chọn trống: báo một lần (toast gộp các báo trùng nhau).
    load().then(setOptions, (e: unknown) => toast.error(errorMessage(e, t)));
    return () => { listeners.delete(setOptions); };
  }, [t]);
  return options;
}

/** Lựa chọn cho ô chọn: ẩn giá trị đã ẩn, trừ giá trị đang dùng (vẫn hiện, ghi "đã ẩn"). */
export function toSelect(items: OptionItem[] | undefined, current?: string | null, hiddenSuffix = ''): SelectOption[] {
  return (items ?? [])
    .filter((o) => o.is_active || o.id === current)
    .map((o) => ({ value: o.id, label: o.is_active ? o.display_name : `${o.display_name}${hiddenSuffix}` }));
}
