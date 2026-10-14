'use client';

/**
 * Trang Equipment: Masterlist full chiều rộng + modal bản ghi (docs/UI.md). Điện thoại hiện mỗi thiết bị
 * một thẻ (serial, Status, vị trí).
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownRight, ListTree, MapPin, Upload } from 'lucide-react';
import { useCan } from '@/components/ViewerContext';
import { RemarkCell, TagChips, UsageTag } from '@/components/ui/tags';
import { ModuleWorkspace, useList } from '@/components/ui/workspace/ModuleWorkspace';
import { ImportModal } from '@/components/ui/ImportModal';
import type { Column } from '@/components/ui/masterlist/Masterlist';
import { IMPORT_COLUMNS } from '@/lib/equipmentImport';
import { EquipmentModal } from './EquipmentModal';
import type { EquipmentRow } from '@/lib/types';

export function EquipmentWorkspace() {
  const { t } = useTranslation();
  const can = useCan();
  const list = useList<EquipmentRow>('/api/equipment');

  // Status, rồi nó là gì (serial, part number, Type), ở đâu (Location), phần còn lại.
  // useMemo: Masterlist memo theo identity của columns / leading / mobileCard (cache chữ tìm kiếm, bộ lọc,
  // TableRow / Card memo) — tạo mảng mới mỗi lần render làm mất hết các cache đó.
  const columns = useMemo<Column<EquipmentRow>[]>(() => [
    { key: 'usage', label: t('fields.usage'), value: (r) => t(`values.${r.usage}`), render: (r) => <UsageTag usage={r.usage} />, filter: true },
    { key: 'serial_number', label: t('fields.serial_number'), value: (r) => r.serial_number, render: (r) => <strong>{r.serial_number}</strong> },
    { key: 'part_number', label: t('fields.part_number'), value: (r) => r.part_number, filter: true },
    { key: 'type', label: t('fields.type'), value: (r) => r.type, filter: true },
    { key: 'location', label: t('fields.location'), value: (r) => r.location, filter: true },
    { key: 'jabil_id', label: t('fields.jabil_id'), value: (r) => r.jabil_id },
    { key: 'asset', label: t('fields.asset'), value: (r) => r.asset },
    { key: 'level', label: t('fields.level'), value: (r) => r.level, filter: true },
    { key: 'parent', label: t('fields.parent'), value: (r) => r.parent_serial, filter: true },
    { key: 'tags', label: t('fields.tags'), value: (r) => r.tags.map((x) => x.display_name).join(', ') || null, filter: true,
      render: (r) => <RemarkCell tags={r.tags} remark={null} /> },
    { key: 'remark', label: t('fields.remark'), value: (r) => r.remark, wrap: true, width: 200 },
  ], [t]);

  /** Có con / là con của thiết bị khác — cột đầu của bảng và thẻ trên điện thoại. */
  const relation = useCallback((r: EquipmentRow) => (r.has_children
    ? <span className="rel" title={t('eq.hasChildrenShort')}><ListTree size={14} aria-label={t('eq.hasChildrenShort')} /></span>
    : r.parent_id ? <span className="rel" title={t('eq.isChild', { serial: r.parent_serial })}><CornerDownRight size={14} aria-label={t('eq.isChild', { serial: r.parent_serial })} /></span>
      : null), [t]);

  const mobileCard = useCallback((r: EquipmentRow) => (
    <>
      <span className="rc-asset-row">
        <span className="rc-asset-type" title={r.type ?? undefined}>{r.type ?? '—'}</span>
        <span className="rc-asset-pn" title={r.part_number ?? undefined}>{r.part_number ?? '—'}</span>
      </span>
      <span className="rc-asset-row">
        <span className="rc-asset-location" title={r.location ?? undefined}><MapPin size={14} aria-hidden="true" /><span>{r.location ?? '—'}</span></span>
        <span className="rc-asset-serial" title={r.serial_number}>{r.serial_number}</span>
      </span>
      <span className="rc-statuses"><UsageTag usage={r.usage} /><TagChips items={r.tags} /></span>
    </>
  ), []);

  const leading = useMemo(() => (
    { label: t('eq.relation'), header: <ListTree size={14} aria-hidden="true" />, render: relation }
  ), [t, relation]);

  return (
    <ModuleWorkspace<EquipmentRow>
      title={t('nav.equipment')}
      list={list}
      columns={columns}
      mobileCard={mobileCard}
      mobileFilterKeys={['usage', 'part_number', 'type', 'location', 'parent', 'tags']}
      searchPlaceholder={t('ml.assetSearchPlaceholder')}
      mobileEmptyState={{ title: t('ml.noEquipment'), subtitle: t('ml.adjustFilters') }}
      storageKey="equipment"
      defaultColumns={['usage', 'serial_number', 'part_number', 'type', 'location', 'jabil_id', 'asset', 'level', 'tags']}
      exportName="equipment"
      canAdd={can.edit}
      addLabel={t('eq.add')}
      tools={can.edit ? [{
        key: 'import', label: t('imp.button'), icon: <Upload size={14} aria-hidden="true" />,
        render: ({ onClose, reload }) => (
          <ImportModal
            endpoint="/api/equipment/import" columns={IMPORT_COLUMNS} title={t('imp.title')} templateDesc={t('imp.step1Desc')}
            importLabel={(count) => t('imp.import', { count })} doneLabel={(count) => t('imp.done', { count })}
            onClose={onClose} onImported={() => { reload(); onClose(); }}
          />
        ),
      }] : undefined}
      leading={leading}
      recordUrl={(id) => `/api/equipment/${id}`}
      renderDetail={(ctx) => <EquipmentModal ctx={ctx} />}
    />
  );
}
