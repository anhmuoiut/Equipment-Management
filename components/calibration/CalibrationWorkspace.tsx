'use client';

/**
 * Trang Calibration: Masterlist (mỗi sub-equipment một dòng, kèm lần hiệu chuẩn mới nhất) + modal bản ghi
 * (docs/UI.md). `?q=` điền sẵn ô tìm (từ nhóm Hiệu chuẩn của một Tester). Danh sách phân trang ở server (usePagedList): Calibration Status,
 * lọc nhanh Overdue / Due soon / Attention, tìm, lọc và sắp xếp đều chạy ở database trên toàn bộ dữ liệu.
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, MapPin, Upload } from 'lucide-react';
import { formatDate } from '@/lib/client/api';
import { useCan } from '@/components/ViewerContext';
import { CalibrationStatusTag, DueDate, RemarkCell, TagChips, UsageTag } from '@/components/ui/tags';
import { ModuleWorkspace } from '@/components/ui/workspace/ModuleWorkspace';
import { useOptions } from '@/lib/client/options';
import { usePagedList } from '@/lib/client/usePagedList';
import { useFilterValues } from '@/lib/client/filterValues';
import { enumChoices, namedChoices, textChoices } from '@/lib/client/listChoices';
import { CALIBRATION_STATUSES, USAGE_STATUSES } from '@/lib/status';
import { ImportModal } from '@/components/ui/ImportModal';
import { RowCard, type Column } from '@/components/ui/masterlist/Masterlist';
import { SUB_IMPORT_COLUMNS } from '@/lib/subEquipmentImport';
import { CalibrationModal } from './CalibrationModal';
import type { SubEquipmentRow } from '@/lib/types';

export function CalibrationWorkspace() {
  const { t } = useTranslation();
  const can = useCan();
  const list = usePagedList<SubEquipmentRow>('/api/calibration', { storageKey: 'calibration' });
  const options = useOptions();
  const filterValues = useFilterValues('calibration');

  // useMemo / useCallback: Masterlist memo theo identity của các prop này (xem EquipmentWorkspace).
  const columns = useMemo<Column<SubEquipmentRow>[]>(() => [
    { key: 'status', label: t('cal.calibrationStatus'), value: (r) => t(`cal.status.${r.status}`), render: (r) => <CalibrationStatusTag status={r.status} />, filter: true,
      choices: enumChoices(CALIBRATION_STATUSES, (v) => t(`cal.status.${v}`)), searchByLabel: true },
    { key: 'usage', label: t('fields.usage'), value: (r) => t(`values.${r.usage}`), render: (r) => <UsageTag usage={r.usage} />, filter: true,
      choices: enumChoices(USAGE_STATUSES, (v) => t(`values.${v}`)), searchByLabel: true },
    { key: 'serial_number', label: t('fields.serial_number'), value: (r) => r.serial_number, render: (r) => <strong>{r.serial_number}</strong> },
    { key: 'part_number', label: t('fields.part_number'), value: (r) => r.part_number, filter: true,
      choices: namedChoices(options?.part_numbers.filter((p) => p.kind === 'sub_equipment')) },
    { key: 'description', label: t('fields.description'), value: (r) => r.description, wrap: true, width: 220 },
    { key: 'manufacturer', label: t('fields.manufacturer'), value: (r) => r.manufacturer, filter: true,
      choices: textChoices([...new Set(options?.part_numbers.filter((p) => p.kind === 'sub_equipment')
        .map((p) => p.manufacturer).filter((value): value is string => !!value))]), emptyChoice: true },
    { key: 'type', label: t('fields.type'), value: (r) => r.type, filter: true,
      choices: namedChoices(options?.types.filter((x) => x.kind === 'sub_equipment')) },
    { key: 'tester', label: t('fields.tester'), value: (r) => r.tester_serial, filter: true, choices: textChoices(filterValues?.tester), emptyChoice: true },
    { key: 'location', label: t('fields.location'), value: (r) => r.location, filter: true, choices: namedChoices(options?.locations) },
    { key: 'calibrated_at', label: t('fields.calibration_date'), value: (r) => r.calibrated_at, render: (r) => (r.calibrated_at ? formatDate(r.calibrated_at) : null) },
    { key: 'due_date', label: t('fields.due_date'), value: (r) => r.due_date, render: (r) => <DueDate date={r.due_date} status={r.status} /> },
    { key: 'vendor', label: t('fields.vendor'), value: (r) => r.vendor, filter: true, choices: namedChoices(options?.calibration_vendors), emptyChoice: true },
    { key: 'cert_no', label: t('fields.cert_no'), value: (r) => r.cert_no },
    { key: 'result', label: t('fields.result'), value: (r) => (r.result ? t(`cal.result.${r.result}`) : null), filter: true,
      choices: enumChoices(['pass', 'fail'] as const, (v) => t(`cal.result.${v}`)), emptyChoice: true, searchByLabel: true },
    { key: 'jabil_id', label: t('fields.jabil_id'), value: (r) => r.jabil_id },
    { key: 'asset', label: t('fields.asset'), value: (r) => r.asset },
    { key: 'tags', label: t('fields.tags'), value: (r) => r.tags.map((x) => x.display_name).join(', ') || null, filter: true,
      render: (r) => <RemarkCell tags={r.tags} remark={null} />, choices: namedChoices(options?.tags), emptyChoice: true },
    { key: 'remark', label: t('fields.remark'), value: (r) => r.remark, wrap: true, width: 200 },
  ], [t, options, filterValues]);

  const mobileCard = useCallback((r: SubEquipmentRow) => (
    <RowCard
      title={r.serial_number}
      tag={<><UsageTag usage={r.usage} /><CalibrationStatusTag status={r.status} /></>}
      lines={[
        <><MapPin size={13} aria-hidden="true" /><span className="rc-place">{r.location ?? '—'}</span>{[r.part_number, r.type].filter(Boolean).map((x) => ` · ${x}`)}</>,
        r.manufacturer ? <><span className="rc-key">{t('fields.manufacturer')}: </span>{r.manufacturer}</> : null,
        r.description ? <><span className="rc-key">{t('fields.description')}: </span>{r.description}</> : null,
        r.due_date ? <><CalendarClock size={13} aria-hidden="true" /><DueDate date={r.due_date} status={r.status} /></> : t('cal.noRecordsYet'),
        r.tags.length ? <TagChips items={r.tags} /> : null,
      ]}
    />
  ), [t]);

  const quickFilters = useMemo(() => [
    { key: 'overdue', label: t('cal.status.overdue'), test: (r: SubEquipmentRow) => r.status === 'overdue' },
    { key: 'due_soon', label: t('cal.status.due_soon'), test: (r: SubEquipmentRow) => r.status === 'due_soon' },
    { key: 'attention', label: t('cal.quickAttention'), test: (r: SubEquipmentRow) => r.status === 'not_calibrated' || r.status === 'failed' },
  ], [t]);

  return (
    <ModuleWorkspace<SubEquipmentRow>
      title={t('nav.calibration')}
      list={list}
      columns={columns}
      mobileCard={mobileCard}
      storageKey="calibration"
      defaultColumns={['status', 'usage', 'serial_number', 'part_number', 'description', 'manufacturer', 'location', 'calibrated_at', 'due_date']}
      exportName="calibration"
      canAdd={can.edit}
      addLabel={t('cal.add')}
      quickFilters={quickFilters}
      rowTone={(r) => (r.status === 'overdue' || r.status === 'failed' ? 'alert' : r.status === 'due_soon' ? 'warn' : undefined)}
      tools={can.edit ? [{
        key: 'import', label: t('imp.button'), icon: <Upload size={14} aria-hidden="true" />,
        render: ({ onClose, reload }) => (
          <ImportModal
            endpoint="/api/calibration/import" columns={SUB_IMPORT_COLUMNS} title={t('simp.title')} templateDesc={t('simp.step1Desc')}
            importLabel={(count) => t('simp.import', { count })} doneLabel={(count) => t('simp.done', { count })}
            onClose={onClose} onImported={() => { reload(); onClose(); }}
          />
        ),
      }] : undefined}
      recordUrl={(id) => `/api/calibration/${id}`}
      renderDetail={(ctx) => <CalibrationModal ctx={ctx} />}
    />
  );
}
