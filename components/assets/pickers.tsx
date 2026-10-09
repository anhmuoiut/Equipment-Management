'use client';

/**
 * Ô chọn thiết bị tìm trên server (docs/DETAIL_MODEL.md 4.1): danh sách cha hợp lệ (`valid_parents`) và thiết bị
 * Swap được (`swap_candidates`) quá dài để tải hết — gõ serial / part number thì hỏi server. Dùng
 * SearchableSelect ở chế độ `onSearch`.
 */
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/client/api';
import { toast } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { fetchSwapCandidates, fetchValidParents } from './api';
import type { AssetType, ParentCandidate, SwapCandidate } from '@/lib/types';

/** Tìm trên server: giữ danh sách mới nhất, bỏ phản hồi cũ, báo lỗi bằng toast. */
function useRemoteList<T>(fetcher: (q: string) => Promise<T[]>) {
  const { t } = useTranslation();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const search = useCallback((q: string) => {
    const n = ++seq.current;
    setLoading(true);
    fetcherRef.current(q).then(
      (list) => { if (n === seq.current) setItems(list); },
      (e: unknown) => { if (n === seq.current) toast.error(errorMessage(e, t)); },
    ).finally(() => { if (n === seq.current) setLoading(false); });
  }, [t]);
  return { items, loading, search };
}

export const parentLabel = (c: ParentCandidate) => [c.serial_number, c.part_number, c.location].filter(Boolean).join(' · ');

/**
 * Chọn thiết bị cha. `assetId`: tài sản có sẵn (Move / sửa); `kind`: loại equipment sắp thêm (tester / base / fixture).
 * `onPick` nhận cả dòng được chọn (vị trí của cha, Status sau khi gắn…) để form hiện "Theo thiết bị cha".
 */
export function ParentPicker({
  type, assetId, kind, value, valueLabel, onChange, onPick, ariaLabel, placeholder, clearable, showUsageAfter,
}: {
  type: AssetType;
  assetId?: string | null;
  kind?: string | null;
  value: string | null;
  /** Nhãn của cha hiện tại (khi chưa có trong danh sách tìm). */
  valueLabel?: string;
  onChange: (id: string | null) => void;
  onPick?: (candidate: ParentCandidate | null) => void;
  ariaLabel: string;
  placeholder: string;
  clearable?: boolean;
  /** Ghi `→ Status sau khi gắn` cạnh mỗi cha (màn hình Move). */
  showUsageAfter?: boolean;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | undefined>();
  const { items, loading, search } = useRemoteList((q) => fetchValidParents(type, { id: assetId, kind, q }));
  const options = items.filter((c) => c.id !== assetId).map((c) => ({
    value: c.id,
    label: showUsageAfter ? `${parentLabel(c)} · → ${t(`values.${c.usage_after}`)}` : parentLabel(c),
  }));
  return (
    <SearchableSelect
      value={value ?? ''} options={options} onSearch={search} loading={loading}
      selectedLabel={picked ?? valueLabel} clearable={clearable} placeholder={placeholder} ariaLabel={ariaLabel}
      onChange={(v) => {
        const candidate = items.find((c) => c.id === v) ?? null;
        setPicked(candidate ? parentLabel(candidate) : undefined);
        onPick?.(candidate);
        onChange(v || null);
      }}
    />
  );
}

export const swapLabel = (c: SwapCandidate) =>
  [c.serial_number, c.part_number, c.location, c.parent_serial ? `↳ ${c.parent_serial}` : null].filter(Boolean).join(' · ');

/** Chọn thiết bị để Swap (cùng Type; golden board thì bất kỳ). */
export function SwapPicker({ type, assetId, value, onChange, onPick, ariaLabel, placeholder }: {
  type: AssetType;
  assetId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  onPick?: (candidate: SwapCandidate | null) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const [picked, setPicked] = useState<string | undefined>();
  const { items, loading, search } = useRemoteList((q) => fetchSwapCandidates(type, assetId, q));
  return (
    <SearchableSelect
      value={value ?? ''} options={items.map((c) => ({ value: c.id, label: swapLabel(c) }))} onSearch={search} loading={loading}
      selectedLabel={picked} placeholder={placeholder} ariaLabel={ariaLabel}
      onChange={(v) => {
        const candidate = items.find((c) => c.id === v) ?? null;
        setPicked(candidate ? swapLabel(candidate) : undefined);
        onPick?.(candidate);
        onChange(v || null);
      }}
    />
  );
}
