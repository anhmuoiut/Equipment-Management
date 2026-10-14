'use client';

/**
 * Cây chứa tài sản đang xem, dùng chung cho modal Equipment / Calibration / Golden (docs/UI.md).
 * MỘT lần tải cho cả cây: id gửi lên server (`anchor`) chỉ đổi khi tài sản đang xem nằm NGOÀI cây đã tải, nên chọn nút khác
 * trong cùng cây không tải lại; sang cây khác thì chờ cây mới. Overview gọi hook này MỘT lần ở trên cả ba modal để cây (và
 * "thiết bị hiện tại") sống qua lúc chuyển giữa các loại tài sản; trang riêng của Equipment tự gọi trong modal của nó.
 */
import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/client/useFetch';
import { assetTreeUrl } from './api';
import type { AssetType, EquipmentTree } from '@/lib/types';

type Ref = { type: AssetType; id: string };

export function useAssetTree({ type, record, version, selectedId }: {
  /** Loại của `record`. */
  type: AssetType;
  /** Tài sản đang hiện (null = chưa có / không dùng cây). */
  record: { id: string } | null;
  /** `ctx.version`: tăng sau mỗi lần reload để tải lại cây. */
  version: number;
  /** Tài sản vừa chọn nhưng có thể còn đang tải (khác `record.id`): cây tô nó ngay. */
  selectedId?: string;
}) {
  const [anchor, setAnchor] = useState<Ref | null>(null);
  const tree = useFetch<EquipmentTree>(anchor ? `${assetTreeUrl(anchor.type, anchor.id)}?_v=${version}` : null);
  useEffect(() => {
    if (record && !tree.data?.nodes.some((n) => n.id === record.id)) {
      setAnchor((prev) => (prev && prev.id === record.id && prev.type === type ? prev : { type, id: record.id }));
    }
  }, [record, type, tree.data]);

  // Tài sản mà modal được mở cho: nút "Thiết bị hiện tại" của cây quay về đây sau khi chọn nút khác.
  const [origin, setOrigin] = useState<Ref | null>(null);
  if (record && origin === null) setOrigin({ type, id: record.id });

  const loaded = record && tree.data?.nodes.some((n) => n.id === record.id) ? tree.data : null;
  // Loại của nút vừa chọn lấy từ chính cây (chưa có trong cây thì giữ tài sản đang hiện).
  const selectedNode = selectedId ? loaded?.nodes.find((n) => n.id === selectedId) : undefined;
  const current: Ref | null = selectedNode ? { type: selectedNode.asset_type, id: selectedNode.id } : record ? { type, id: record.id } : null;

  return { tree, loaded, current, home: origin ?? undefined };
}

export type AssetTreeState = ReturnType<typeof useAssetTree>;
