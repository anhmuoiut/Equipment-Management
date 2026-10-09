'use client';

/** Trang Golden: Masterlist full chiều rộng + modal bản ghi (docs/DETAIL_MODEL.md 4.3). */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Upload } from 'lucide-react';
import { useCan } from '@/components/ViewerContext';
import { RemarkCell, UsageTag } from '@/components/ui/tags';
import { ModuleWorkspace, useList } from '@/components/ui/workspace/ModuleWorkspace';
import { ImportModal } from '@/components/ui/ImportModal';
import { RowCard, type Column } from '@/components/ui/masterlist/Masterlist';
import { GOLDEN_IMPORT_COLUMNS } from '@/lib/goldenImport';
import { GoldenModal } from './GoldenModal';
import type { GoldenRow } from '@/lib/types';

export function GoldenWorkspace() {
  const { t } = useTranslation();
  const can = useCan();
  const list = useList<GoldenRow>('/api/golden');

  // useMemo / useCallback: Masterlist memo theo identity của các prop này (xem EquipmentWorkspace).
  const columns = useMemo<Column<GoldenRow>[]>(() => [
    { key: 'usage', label: t('fields.usage'), value: (r) => t(`values.${r.usage}`), render: (r) => <UsageTag usage={r.usage} />, filter: true },
    { key: 'serial_number', label: t('fields.serial_number'), value: (r) => r.serial_number, render: (r) => <strong>{r.serial_number}</strong> },
    { key: 'part_number', label: t('fields.part_number'), value: (r) => r.part_number, filter: true },
    { key: 'utd_part_number', label: t('fields.utd_part_number'), value: (r) => r.utd_part_number },
    { key: 'location', label: t('fields.location'), value: (r) => r.location, filter: true },
    { key: 'purpose', label: t('fields.purpose'), value: (r) => r.purpose, wrap: true, width: 160 },
    { key: 'origin', label: t('fields.origin'), value: (r) => r.origin, filter: true },
    { key: 'parent', label: t('asset.attachedTo'), value: (r) => r.parent_serial, filter: true },
    { key: 'tags', label: t('fields.tags'), value: (r) => r.tags.map((x) => x.display_name).join(', ') || null, filter: true,
      render: (r) => <RemarkCell tags={r.tags} remark={null} /> },
    { key: 'remark', label: t('fields.remark'), value: (r) => r.remark, wrap: true, width: 200 },
  ], [t]);

  const mobileCard = useCallback((r: GoldenRow) => (
    <RowCard
      title={r.serial_number}
      tag={<UsageTag usage={r.usage} />}
      lines={[
        <><MapPin size={13} aria-hidden="true" /><span className="rc-place">{r.location ?? '—'}</span>{[r.part_number, r.utd_part_number].filter(Boolean).map((x) => ` · ${x}`)}</>,
        r.purpose,
      ]}
    />
  ), []);

  const quickFilters = useMemo(() => [
    { key: 'unattached', label: t('asset.quickUnattached'), test: (r: GoldenRow) => !r.parent_id },
  ], [t]);

  return (
    <ModuleWorkspace<GoldenRow>
      title={t('nav.golden')}
      list={list}
      columns={columns}
      mobileCard={mobileCard}
      storageKey="golden"
      defaultColumns={['usage', 'serial_number', 'part_number', 'location', 'purpose', 'utd_part_number']}
      exportName="golden-boards"
      canAdd={can.edit}
      addLabel={t('gs.add')}
      quickFilters={quickFilters}
      tools={can.edit ? [{
        key: 'import', label: t('imp.button'), icon: <Upload size={14} aria-hidden="true" />,
        render: ({ onClose, reload }) => (
          <ImportModal
            endpoint="/api/golden/import" columns={GOLDEN_IMPORT_COLUMNS} title={t('gimp.title')} templateDesc={t('gimp.step1Desc')}
            importLabel={(count) => t('gimp.import', { count })} doneLabel={(count) => t('gimp.done', { count })}
            onClose={onClose} onImported={() => { reload(); onClose(); }}
          />
        ),
      }] : undefined}
      recordUrl={(id) => `/api/golden/${id}`}
      renderDetail={(ctx) => <GoldenModal ctx={ctx} />}
    />
  );
}
