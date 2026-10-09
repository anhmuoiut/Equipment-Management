'use client';

/**
 * Quan hệ cha – con trong chi tiết tài sản (docs/DETAIL_MODEL.md 4.1): chip `SN · PN` bấm để mở; thao tác
 * (Thêm thiết bị con, Gắn vào…) là liên kết chữ dẫn tới đúng màn hình thao tác của modal.
 */
import { useRouter } from 'next/navigation';
import { useRecordContext } from '@/components/ui/record/context';
import { CalibrationStatusTag } from '@/components/ui/tags';
import { assetHref } from './api';
import type { AssetType, CalibrationStatus } from '@/lib/types';

export function RelationChip({ serial, part, status, onClick }: {
  serial: string; part?: string | null; status?: CalibrationStatus | null; onClick: () => void;
}) {
  return (
    <button type="button" className="eq-chip" onClick={onClick}>
      <span className="eq-chip-serial">{serial}</span>
      {part && <span className="eq-chip-part">{part}</span>}
      {status && <CalibrationStatusTag status={status} />}
    </button>
  );
}

/** Liên kết chữ trong chi tiết dẫn tới một thao tác (chỉ hiện với người sửa được). */
export function ActionLink({ action, children }: { action: string; children: string }) {
  const record = useRecordContext();
  return <button type="button" className="link" onClick={() => record?.openAction(action)}>{children}</button>;
}

/**
 * Mở một tài sản: cùng module → mở trong chính modal này (breadcrumb `← SN-001 › SN-002`); module khác →
 * chuyển tới trang module đó với `?id=` — modal cũ đóng, modal mới mở (luôn chỉ một modal).
 */
export function useOpenAsset(sameType: AssetType, openSame?: (id: string) => void) {
  const router = useRouter();
  return (type: AssetType, id: string) => {
    if (type === sameType && openSame) openSame(id);
    else router.push(assetHref(type, id));
  };
}

export function RelationList({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <span className="dp-empty">{empty}</span>;
  return <div className="eq-rel">{children}</div>;
}
