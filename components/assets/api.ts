'use client';

/**
 * Phần dùng chung của ba module tài sản (Equipment, Calibration, Golden): đường dẫn, quan hệ cha – con và
 * các lời gọi thao tác trên cây (Đổi vị trí, Move, Detach, Swap, Xóa, Check-out / Check-in) — luôn đi qua
 * `/api/assets/*` với `dry_run` để xem trước mục "Kết quả" (docs/ARCHITECTURE.md "Thao tác trên cây tài sản").
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/client/api';
import type {
  AssetOpResult, AssetType, EquipmentRow, GoldenRow, ParentCandidate, SerialMatch, SubEquipmentRow, SwapCandidate, Usage,
} from '@/lib/types';

export const ASSET_API: Record<AssetType, string> = {
  equipment: '/api/equipment', sub_equipment: '/api/calibration', golden_board: '/api/golden',
};
export const ASSET_ROUTE: Record<AssetType, string> = {
  equipment: '/equipment', sub_equipment: '/calibration', golden_board: '/golden',
};
export const assetHref = (type: AssetType, id: string) => `${ASSET_ROUTE[type]}?id=${encodeURIComponent(id)}`;
/** Cây chứa tài sản: Equipment giữ đường dẫn riêng của nó; sub-equipment / golden board hỏi qua `/api/assets`. */
export const assetTreeUrl = (type: AssetType, id: string) => (type === 'equipment' ? `/api/equipment/${id}/tree` : `/api/assets/${type}/${id}/tree`);

export type AssetRecord = EquipmentRow | SubEquipmentRow | GoldenRow;

/** Cha trực tiếp của một tài sản (Equipment/Golden: parent_id; Sub-equipment: tester_id). */
export function parentOf(type: AssetType, record: AssetRecord): { id: string; serial: string | null } | null {
  if (type === 'sub_equipment') {
    const r = record as SubEquipmentRow;
    return r.tester_id ? { id: r.tester_id, serial: r.tester_serial } : null;
  }
  const r = record as EquipmentRow | GoldenRow;
  return r.parent_id ? { id: r.parent_id, serial: r.parent_serial } : null;
}

type OpName = 'change-location' | 'move' | 'detach' | 'swap';

export async function runOp(type: AssetType, id: string, op: OpName, body: Record<string, unknown>, dryRun: boolean): Promise<AssetOpResult> {
  return (await api.post<AssetOpResult>(`/api/assets/${type}/${id}/${op}`, dryRun ? { ...body, dry_run: true } : body)).data;
}

export async function deleteAsset(type: AssetType, id: string, dryRun: boolean): Promise<AssetOpResult> {
  return (await api.delete<AssetOpResult>(`/api/assets/${type}/${id}${dryRun ? '?dry_run=1' : ''}`)).data;
}

export async function setUsage(type: AssetType, id: string, usage: Usage, note: string | null, dryRun: boolean): Promise<AssetOpResult> {
  return (await api.post<AssetOpResult>('/api/assets/usage', {
    refs: [{ type, id }], usage, ...(note ? { note } : {}), ...(dryRun ? { dry_run: true } : {}),
  })).data;
}

export async function fetchValidParents(
  type: AssetType, o: { id?: string | null; kind?: string | null; q?: string; limit?: number },
): Promise<ParentCandidate[]> {
  const sp = new URLSearchParams();
  if (o.id) sp.set('id', o.id);
  if (o.kind) sp.set('kind', o.kind);
  if (o.q) sp.set('q', o.q);
  sp.set('limit', String(o.limit ?? 50));
  return (await api.get<ParentCandidate[]>(`/api/assets/${type}/valid-parents?${sp}`)).data;
}

export async function fetchSwapCandidates(type: AssetType, id: string, q: string): Promise<SwapCandidate[]> {
  return (await api.get<SwapCandidate[]>(`/api/assets/${type}/${id}/swap-candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`)).data;
}

export async function fetchSerialMatches(serial: string, exclude?: { type: AssetType; id: string }): Promise<SerialMatch[]> {
  const sp = new URLSearchParams({ serial });
  if (exclude) { sp.set('exclude_type', exclude.type); sp.set('exclude_id', exclude.id); }
  return (await api.get<SerialMatch[]>(`/api/assets/serial-matches?${sp}`)).data;
}

/**
 * Chạy thử một thao tác (dry run) để vẽ mục "Kết quả": chạy lại khi `key` đổi (mỗi lựa chọn của người dùng
 * một key); `run = null` = chưa đủ thông tin. Bỏ qua phản hồi cũ khi đã đổi lựa chọn.
 */
export function useDryRun(run: (() => Promise<AssetOpResult>) | null, key: string) {
  const { t } = useTranslation();
  const enabled = run !== null;
  const [state, setState] = useState<{ key: string; enabled: boolean; result: AssetOpResult | null; loading: boolean; error: string | null }>({
    key, enabled, result: null, loading: enabled, error: null,
  });
  useEffect(() => {
    if (!run) { setState({ key, enabled, result: null, loading: false, error: null }); return; }
    let current = true;
    setState({ key, enabled, result: null, loading: true, error: null });
    run().then(
      (result) => { if (current) setState({ key, enabled, result, loading: false, error: null }); },
      (e: unknown) => { if (current) setState({ key, enabled, result: null, loading: false, error: errorMessage(e, t) }); },
    );
    return () => { current = false; };
    // key đại diện cho các lựa chọn; run đổi identity mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  // A new selection must never render or enable confirmation using the previous selection's preview.
  const { key: resultKey, enabled: resultEnabled, ...result } = state;
  return resultKey === key && resultEnabled === enabled ? result : { result: null, loading: enabled, error: null };
}
