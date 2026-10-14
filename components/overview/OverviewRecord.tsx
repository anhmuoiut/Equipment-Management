'use client';

/**
 * Modal của Overview (docs/DETAIL_MODEL.md 4.6): chi tiết ở bên trái, cây thiết bị ở bên phải, cho cả ba loại tài sản —
 * equipment → Equipment, sub_equipment → Calibration, golden_board → Golden. Không có footer riêng.
 *
 * Chọn một nút / chip thuộc loại KHÁC (ví dụ từ Tester sang một Sub) vẫn là cùng một modal: ba hook của ba module được gọi ở đây
 * rồi chỉ MỘT `RecordModal` được vẽ, nên khung, cây (nút đang mở, vị trí cuộn, chữ tìm) và tab không bị mount lại; chỉ props đổi.
 * Trong lúc bản ghi vừa chọn còn đang tải, bản ghi trước vẫn hiện (mờ đi) — không bao giờ để trống cả modal.
 * Sau mỗi thay đổi (lưu, Swap, Move, Check-out…) bảng tải lại (`onChanged`).
 */
import { useCallback, useState } from 'react';
import { useFetch } from '@/lib/client/useFetch';
import { ASSET_API } from '@/components/assets/api';
import { useAssetTree } from '@/components/assets/useAssetTree';
import { useEquipmentModal } from '@/components/equipment/EquipmentModal';
import { useCalibrationModal } from '@/components/calibration/CalibrationModal';
import { useGoldenModal } from '@/components/golden/GoldenModal';
import { RecordModal, type RecordModalProps } from '@/components/ui/record/RecordModal';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import type { AssetType, EquipmentRow, GoldenRow, SubEquipmentRow } from '@/lib/types';

type Row = { id: string };

export function OverviewRecord({ type, id, tab, onClose, onChanged, onOpen }: {
  /** Loại và id của tài sản đang được CHỌN (từ URL). */
  type: AssetType;
  id: string;
  /** Tab mở sẵn của modal Equipment (`tree` = Cây thiết bị); các modal khác không có tab này. */
  tab?: string | null;
  onClose: () => void;
  /** Dữ liệu đổi: tải lại bảng. */
  onChanged: () => void;
  /** Mở tài sản bất kỳ loại nào (nút trong cây, chip cha / con) ngay trong modal này. */
  onOpen: (type: AssetType, id: string) => void;
}) {
  const fetched = useFetch<Row>(`${ASSET_API[type]}/${id}`);
  const [version, setVersion] = useState(0);
  // useFetch giữ dữ liệu cũ khi đổi id / loại: `shown` là bản ghi ĐANG HIỆN (cùng loại với nó), chỉ đổi khi bản của tài sản vừa chọn về.
  // Nhờ vậy chọn một nút không đưa cả modal về khung xương, và modal vẫn đúng loại của bản ghi đang hiện (kể cả khi loại vừa chọn khác).
  const fresh = fetched.data && fetched.data.id === id ? fetched.data : null;
  const [shown, setShown] = useState<{ type: AssetType; row: Row } | null>(null);
  if (fresh && (shown === null || shown.row !== fresh || shown.type !== type)) setShown({ type, row: fresh });
  const record = fetched.error ? null : shown?.row ?? null;
  const shownType = shown?.type ?? type;

  const reload = useCallback(() => { setVersion((v) => v + 1); fetched.reload(); onChanged(); }, [fetched, onChanged]);

  const base: DetailCtx<Row> = {
    record,
    id,
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
    open: (target) => onOpen(shownType, target),
    openAny: onOpen,
  };
  /** Chỉ modal của loại đang hiện nhận bản ghi; hai modal còn lại chạy "rỗng" (không tải gì) để thứ tự hook luôn cố định. */
  const ctxFor = <R,>(forType: AssetType) => (
    forType === shownType ? base : { ...base, record: null, id: undefined, loading: false, error: null }
  ) as unknown as DetailCtx<R>;

  // Cây của cả ba loại: MỘT lần tải, giữ ở đây nên sống qua lúc chuyển loại.
  const treeState = useAssetTree({ type: shownType, record, version, selectedId: id });

  const equipment = useEquipmentModal(ctxFor<EquipmentRow>('equipment'), { initialTab: tab ?? undefined, treeState });
  const calibration = useCalibrationModal(ctxFor<SubEquipmentRow>('sub_equipment'), { treeState });
  const golden = useGoldenModal(ctxFor<GoldenRow>('golden_board'), { treeState });
  const props = (shownType === 'sub_equipment' ? calibration : shownType === 'golden_board' ? golden : equipment) as unknown as RecordModalProps<EquipmentRow>;

  return <RecordModal<EquipmentRow> {...props} />;
}
