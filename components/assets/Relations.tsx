'use client';

/**
 * Quan hệ cha – con trong chi tiết tài sản (docs/UI.md): dòng chữ `SN · Type` bấm để mở; thao tác
 * (Thêm thiết bị con, Gắn vào…) là liên kết chữ dẫn tới đúng màn hình thao tác của modal.
 */
import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useFetch } from '@/lib/client/useFetch';
import { useRecordContext } from '@/components/ui/record/context';
import { CalibrationStatusTag } from '@/components/ui/tags';
import { assetHref } from './api';
import type { AssetType, CalibrationStatus, EquipmentRow } from '@/lib/types';

export function RelationChip({ serial, typeName, status, onClick }: {
  serial: string; typeName?: string | null; status?: CalibrationStatus | null; onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button type="button" className="eq-relation-link" onClick={onClick}>
      <span className="eq-relation-label">
        <span className="eq-relation-serial">{serial}</span>
        <span aria-hidden="true"> · </span>
        <span className="eq-relation-type">{typeName || t('ml.emptyValue')}</span>
      </span>
      {status && <CalibrationStatusTag status={status} />}
    </button>
  );
}

/** Read the parent's Type from the existing detail API when it is not already in the equipment tree. */
export function ParentRelation({ id, serial, typeName, version, onClick }: {
  id: string; serial: string; typeName?: string | null; version: number; onClick: () => void;
}) {
  const { data } = useFetch<EquipmentRow>(typeName ? null : `/api/equipment/${id}?_v=${version}`);
  const parentType = typeName ?? (data?.id === id ? data.type : null);
  return <RelationChip serial={serial} typeName={parentType} onClick={onClick} />;
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
export function useOpenAsset(sameType: AssetType, openSame?: (id: string) => void, openAny?: (type: AssetType, id: string) => void) {
  const router = useRouter();
  return (type: AssetType, id: string) => {
    // Overview: mọi loại mở ngay trong modal đang mở (cây + chi tiết là một màn hình).
    if (openAny) openAny(type, id);
    else if (type === sameType && openSame) openSame(id);
    else router.push(assetHref(type, id));
  };
}

export function RelationList({ children, empty }: { children: ReactNode[]; empty: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (children.length === 0) return <span className="dp-empty">{empty}</span>;
  return (
    <div className="eq-rel">
      <div className="eq-rel-rows" id={id}>{expanded ? children : children.slice(0, 1)}</div>
      {children.length > 1 && (
        <button type="button" className="eq-rel-more" aria-expanded={expanded} aria-controls={id}
          onClick={() => setExpanded((value) => !value)}>
          {expanded ? t('asset.showLessRelations') : t('asset.showMoreRelations', { count: children.length - 1 })}
        </button>
      )}
    </div>
  );
}
