'use client';

/**
 * Modal của Overview (docs/DETAIL_MODEL.md 4.6): đúng modal của module sở hữu bản ghi, chọn theo `type` trên URL —
 * equipment → Equipment, sub_equipment → Calibration, golden_board → Golden. Không có footer riêng.
 * Sau mỗi thay đổi (lưu, Swap, Move, Check-out…) bảng tải lại (`onChanged`).
 */
import { useCallback, useState } from 'react';
import { useFetch } from '@/lib/client/useFetch';
import { ASSET_API } from '@/components/assets/api';
import { EquipmentModal } from '@/components/equipment/EquipmentModal';
import { CalibrationModal } from '@/components/calibration/CalibrationModal';
import { GoldenModal } from '@/components/golden/GoldenModal';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import type { AssetType, EquipmentRow, GoldenRow, SubEquipmentRow } from '@/lib/types';

type Row = { id: string };

export function OverviewRecord({ type, id, tab, onClose, onChanged, onOpen }: {
  type: AssetType;
  id: string;
  /** Tab mở sẵn của modal Equipment (`tree` = Cây thiết bị); các modal khác không có tab này. */
  tab?: string | null;
  onClose: () => void;
  /** Dữ liệu đổi: tải lại bảng. */
  onChanged: () => void;
  /** Mở bản ghi liên quan cùng loại ngay trong modal. */
  onOpen: (id: string) => void;
}) {
  const fetched = useFetch<Row>(`${ASSET_API[type]}/${id}`);
  const [version, setVersion] = useState(0);
  const record = fetched.data && fetched.data.id === id ? fetched.data : null;

  const reload = useCallback(() => { setVersion((v) => v + 1); fetched.reload(); onChanged(); }, [fetched, onChanged]);

  const ctx: DetailCtx<Row> = {
    record,
    creating: false,
    loading: fetched.loading && !record,
    error: fetched.error,
    onRetry: fetched.reload,
    nav: {},
    trail: [],
    onClose,
    onSaved: (row) => { fetched.setData(row); onChanged(); },
    onDeleted: () => { onChanged(); onClose(); },
    reload,
    version,
    open: (target) => onOpen(target),
  };

  if (type === 'sub_equipment') return <CalibrationModal ctx={ctx as unknown as DetailCtx<SubEquipmentRow>} />;
  if (type === 'golden_board') return <GoldenModal ctx={ctx as unknown as DetailCtx<GoldenRow>} />;
  return <EquipmentModal ctx={ctx as unknown as DetailCtx<EquipmentRow>} initialTab={tab ?? undefined} />;
}
