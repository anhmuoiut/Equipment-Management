'use client';

/**
 * Modal Calibration — sub-equipment và các lần hiệu chuẩn của chúng (docs/DETAIL_MODEL.md 4.2). Footer chung của
 * ba module tài sản; riêng nút [Ghi nhận hiệu chuẩn] (đứng trước Check-out) và tab Hiệu chuẩn. Overview dùng lại
 * đúng component này cho `type=sub_equipment`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ClipboardCheck, MapPin } from 'lucide-react';
import { api, formatDate, formatRelativeTime } from '@/lib/client/api';
import { toSelect, useOptions } from '@/lib/client/options';
import { useCan } from '@/components/ViewerContext';
import { CalibrationStatusTag, DueDate, TagChips, UsageTag } from '@/components/ui/tags';
import { TagPicker } from '@/components/ui/TagPicker';
import { RecordModal, type ActionDef } from '@/components/ui/record/RecordModal';
import { useRecordContext } from '@/components/ui/record/context';
import { DetailValue, type SectionDef } from '@/components/ui/record/fields';
import type { DetailCtx } from '@/components/ui/workspace/ModuleWorkspace';
import { assetActions } from '@/components/assets/actions';
import { fetchSerialMatches } from '@/components/assets/api';
import { ParentPicker } from '@/components/assets/pickers';
import { ActionLink, RelationChip, RelationList, useOpenAsset } from '@/components/assets/Relations';
import { SerialWarning } from '@/components/assets/SerialWarning';
import { CalibrationRecordsTab, EditCalibrationScreen, RecordCalibrationScreen, RemoveCalibrationScreen } from './CalibrationScreens';
import type { CalibrationRecord, ParentCandidate, SubEquipmentRow } from '@/lib/types';

export function CalibrationModal({ ctx }: { ctx: DetailCtx<SubEquipmentRow> }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const options = useOptions();
  const can = useCan();
  const hidden = ` (${t('cfg.hidden')})`;
  const record = ctx.creating ? null : ctx.record;
  const openAsset = useOpenAsset('sub_equipment');
  const [picked, setPicked] = useState<ParentCandidate | null>(null);
  /** Lần hiệu chuẩn đang sửa / xóa (chọn ở tab Hiệu chuẩn, hiện ở màn hình riêng trong modal). */
  const [editing, setEditing] = useState<CalibrationRecord | null>(null);

  const testerLocation = (testerId: unknown) =>
    (typeof testerId === 'string' && picked?.id === testerId ? picked.location : record && testerId === record.tester_id ? record.location : null);

  const sections: SectionDef<SubEquipmentRow>[] = [
    {
      key: 'identity', title: t('eq.groupIdentity'), fields: [
        { key: 'serial_number', label: t('fields.serial_number'), required: true, maxLength: 200 },
        { key: 'part_number_id', label: t('fields.part_number'), kind: 'select', required: true, view: (r) => r.part_number,
          options: (_d, r) => toSelect(options?.part_numbers.filter((p) => p.kind === 'sub_equipment' || p.id === r?.part_number_id), r?.part_number_id, hidden) },
        { key: 'jabil_id', label: t('fields.jabil_id'), maxLength: 200 },
        { key: 'asset', label: t('fields.asset'), maxLength: 200 },
      ],
    },
    {
      key: 'classification', title: t('eq.groupClassification'), fields: [
        { key: 'type_id', label: t('fields.type'), readOnly: true, hint: t('eq.typeFromPartNumber'), view: (r) => r.type,
          draftView: (d) => {
            const typeId = options?.part_numbers.find((p) => p.id === d.part_number_id)?.type_id;
            return typeId ? options?.types.find((x) => x.id === typeId)?.display_name ?? '—' : '—';
          } },
        { key: 'usage', label: t('fields.usage'), readOnly: true, hideInCreate: true, hint: t('eq.usageHint'), view: (r) => <UsageTag usage={r.usage} /> },
      ],
    },
    {
      key: 'location', title: t('eq.groupLocationRelation'), fields: [
        { key: 'location_id', label: t('fields.location'), kind: 'select', required: (d) => !d.tester_id,
          view: (r) => (r.tester_id ? <>{r.location}<span className="eq-note">{t('asset.fromTester')}</span></> : r.location),
          options: (_d, r) => toSelect(options?.locations, r?.location_id, hidden),
          lock: (_r, d) => (d.tester_id ? t('asset.locationFromTester') : null),
          draftView: (d) => testerLocation(d.tester_id) },
        { key: 'tester_id', label: t('fields.tester'), wide: true,
          view: (r) => (r.tester_id ? (
            <RelationList empty="">
              {[<RelationChip key="t" serial={r.tester_serial ?? '—'} onClick={() => openAsset('equipment', r.tester_id!)} />]}
            </RelationList>
          ) : (
            <>
              <span className="dp-empty">{t('asset.noTester')}</span>
              {can.edit && <> <ActionLink action="attach">{t('asset.attach.sub_equipment')}</ActionLink></>}
            </>
          )),
          draftView: (d) => (d.tester_id ? (picked?.id === d.tester_id ? picked.serial_number : record?.tester_serial ?? '—') : <span className="dp-empty">{t('asset.noTester')}</span>),
          editHint: t('asset.testerHint'),
          editor: ({ value, onChange, label, record: r }) => (
            <ParentPicker type="sub_equipment" assetId={r?.id} value={(value as string | null) ?? null} valueLabel={r?.tester_serial ?? undefined}
              onChange={onChange} onPick={setPicked} clearable ariaLabel={label} placeholder={t('asset.noTester')} />
          ) },
      ],
    },
    {
      key: 'current', title: t('cal.groupCurrent'), hideInCreate: true,
      render: (r) => (r.calibration_id ? (
        <>
          <DetailValue label={t('cal.calibrationStatus')} hint={t('cal.autoComputed')}><CalibrationStatusTag status={r.status} /></DetailValue>
          <DetailValue label={t('fields.calibration_date')}>{r.calibrated_at ? formatDate(r.calibrated_at) : null}</DetailValue>
          <DetailValue label={t('fields.due_date')} hint={t('cal.autoComputed')}><DueDate date={r.due_date} status={r.status} /></DetailValue>
          <DetailValue label={t('fields.vendor')}>{r.vendor}</DetailValue>
          <DetailValue label={t('fields.cert_no')}>{r.cert_no}</DetailValue>
          <DetailValue label={t('fields.cert_file_url')}>
            {r.cert_file_url && <a className="link" href={r.cert_file_url} target="_blank" rel="noreferrer noopener">{t('cal.certFile')}</a>}
          </DetailValue>
          <DetailValue label={t('fields.result')}>{r.result ? t(`cal.result.${r.result}`) : null}</DetailValue>
        </>
      ) : (
        <>
          <DetailValue label={t('cal.calibrationStatus')}><CalibrationStatusTag status={r.status} /></DetailValue>
          <DetailValue label={t('cal.current')} wide><span className="dp-empty">{t('cal.noRecordsYet')}</span></DetailValue>
        </>
      )),
    },
    {
      key: 'cycle', title: t('cal.groupInterval'), hideInCreate: true,
      render: (r) => (r.interval_months ? (
        <>
          <DetailValue label={t('fields.interval_months')}>{t('cal.months', { count: r.interval_months })}</DetailValue>
          <DetailValue label={t('fields.warning_days')}>{r.warning_days ? t('cal.days', { count: r.warning_days }) : null}</DetailValue>
        </>
      ) : <DetailValue label={t('fields.interval_months')} wide><span className="dp-empty">{t('cal.noIntervalHint')}</span></DetailValue>),
    },
    {
      key: 'notes', title: t('eq.groupNotes'), fields: [
        { key: 'tag_ids', label: t('fields.tags'), wide: true, hint: t('tag.hint'),
          view: (r) => (r.tags.length ? <TagChips items={r.tags} /> : <span className="dp-empty">{t('tag.none')}</span>),
          editor: ({ id, value, onChange, label }) => <TagPicker id={id} value={value} onChange={onChange} tags={options?.tags} label={label} /> },
        { key: 'remark', label: t('fields.remark'), kind: 'textarea', wide: true, maxLength: 1000 },
      ],
    },
  ];

  const extra: ActionDef<SubEquipmentRow>[] = [
    { key: 'record', label: t('cal.record'), icon: <ClipboardCheck size={14} aria-hidden="true" />, primary: true,
      screen: (c) => <RecordCalibrationScreen ctx={c} /> },
    { key: 'edit-calibration', label: t('cal.editRecord'), hidden: true, screen: (c) => <EditCalibrationScreen ctx={c} rec={editing} /> },
    { key: 'remove-calibration', label: t('cal.removeRecord'), hidden: true, danger: true, visible: () => can.remove,
      screen: (c) => <RemoveCalibrationScreen ctx={c} rec={editing} /> },
  ];
  const actions = assetActions<SubEquipmentRow>({ type: 'sub_equipment', t, isAdmin: can.remove, extra });

  return (
    <RecordModal<SubEquipmentRow>
      {...ctx}
      record={record}
      size="l"
      canEdit={can.edit}
      createTitle={t('cal.addTitle')}
      heading={(r) => ({
        title: r.serial_number,
        tags: <><CalibrationStatusTag status={r.status} /><UsageTag usage={r.usage} /><TagChips items={r.tags} /></>,
        subtitle: [r.part_number, r.type].filter(Boolean).join(' · ') || undefined,
        meta: (
          <>
            {r.location && <span data-primary><MapPin size={12} aria-hidden="true" /> {r.location}</span>}
            {r.tester_serial && <span>{t('fields.tester')}: {r.tester_serial}</span>}
            {r.due_date && <span><CalendarClock size={12} aria-hidden="true" /> <DueDate date={r.due_date} status={r.status} /></span>}
            {r.interval_months && <span>{t('cal.everyMonths', { count: r.interval_months })}</span>}
            <span>{t('dp.updated', { when: formatRelativeTime(r.updated_at, language), who: r.updated_by_name ?? '—' })}</span>
          </>
        ),
      })}
      sections={sections}
      extraTabs={[{
        key: 'records', label: t('cal.tabRecords'),
        render: (r) => <RecordsTab subId={r.id} version={ctx.version} onPick={setEditing} />,
      }]}
      historyUrl={(r) => `/api/calibration/${r.id}/history`}
      historyFilter={{ label: t('cal.onlyCalibrations'), param: 'only=calibrations' }}
      historyLabels={{ tester: t('fields.tester') }}
      beforeSave={async (payload, current) => {
        const serial = typeof payload.serial_number === 'string' ? payload.serial_number : null;
        if (!serial) return null;
        const matches = await fetchSerialMatches(serial, current ? { type: 'sub_equipment', id: current.id } : undefined);
        return matches.length ? <SerialWarning matches={matches} /> : null;
      }}
      onSave={async (payload, current) => {
        const res = current
          ? await api.put<SubEquipmentRow>(`/api/calibration/${current.id}`, payload)
          : await api.post<SubEquipmentRow>('/api/calibration', payload);
        return { row: res.data };
      }}
      actions={actions}
    />
  );
}

/** Tab Hiệu chuẩn: chọn một lần → mở màn hình sửa lần đó trong modal. */
function RecordsTab({ subId, version, onPick }: { subId: string; version: number; onPick: (rec: CalibrationRecord) => void }) {
  const record = useRecordContext();
  return <CalibrationRecordsTab subId={subId} version={version} onEdit={(rec) => { onPick(rec); record?.openAction('edit-calibration'); }} />;
}
