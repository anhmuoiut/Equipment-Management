'use client';

/**
 * Trang Equipment: Masterlist full chiều rộng + modal bản ghi (docs/DETAIL_MODEL.md 4.1). Điện thoại hiện mỗi thiết bị
 * một thẻ (serial, Status, vị trí).
 */
import { useTranslation } from 'react-i18next';
import { CornerDownRight, ListTree, MapPin, Upload } from 'lucide-react';
import { useCan } from '@/components/ViewerContext';
import { RemarkCell, UsageTag } from '@/components/ui/tags';
import { ModuleWorkspace, useList } from '@/components/ui/workspace/ModuleWorkspace';
import { ImportModal } from '@/components/ui/ImportModal';
import { RowCard, type Column } from '@/components/ui/masterlist/Masterlist';
import { IMPORT_COLUMNS } from '@/lib/equipmentImport';
import { EquipmentModal } from './EquipmentModal';
import type { EquipmentRow } from '@/lib/types';

export function EquipmentWorkspace() {
  const { t } = useTranslation();
  const can = useCan();
  const list = useList<EquipmentRow>('/api/equipment');

  // Status, rồi nó là gì (serial, part number, Type), ở đâu (Location), phần còn lại.
  const columns: Column<EquipmentRow>[] = [
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
  ];

  /** Có con / là con của thiết bị khác — cột đầu của bảng và thẻ trên điện thoại. */
  const relation = (r: EquipmentRow) => (r.has_children
    ? <span className="rel" title={t('eq.hasChildrenShort')}><ListTree size={14} aria-label={t('eq.hasChildrenShort')} /></span>
    : r.parent_id ? <span className="rel" title={t('eq.isChild', { serial: r.parent_serial })}><CornerDownRight size={14} aria-label={t('eq.isChild', { serial: r.parent_serial })} /></span>
      : null);

  return (
    <ModuleWorkspace<EquipmentRow>
      title={t('nav.equipment')}
      list={list}
      columns={columns}
      mobileCard={(r) => (
        <RowCard
          title={<>{r.serial_number}{relation(r)}</>}
          tag={<UsageTag usage={r.usage} />}
          lines={[
            <><MapPin size={13} aria-hidden="true" /><span className="rc-place">{r.location ?? '—'}</span>{[r.part_number, r.type, r.jabil_id].filter(Boolean).map((x) => ` · ${x}`)}</>,
          ]}
        />
      )}
      storageKey="equipment"
      defaultColumns={['usage', 'serial_number', 'part_number', 'type', 'location', 'jabil_id', 'asset', 'level', 'tags']}
      exportName="equipment"
      canAdd={can.edit}
      addLabel={t('eq.add')}
      quickFilters={[{ key: 'unattached', label: t('asset.quickUnattached'), test: (r) => r.kind !== 'tester' && !r.parent_id }]}
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
      leading={{ label: t('eq.relation'), header: <ListTree size={14} aria-hidden="true" />, render: relation }}
      recordUrl={(id) => `/api/equipment/${id}`}
      renderDetail={(ctx) => <EquipmentModal ctx={ctx} />}
    />
  );
}
