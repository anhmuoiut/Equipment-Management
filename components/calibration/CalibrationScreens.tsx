'use client';

/**
 * Màn hình trong modal Calibration (docs/DETAIL_MODEL.md 4.2): Ghi nhận hiệu chuẩn (kèm xem trước "Hạn mới"),
 * Sửa một lần hiệu chuẩn nhập sai, Xóa một lần hiệu chuẩn (Admin) và tab Hiệu chuẩn liệt kê mọi lần.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { addMonths, api, formatDate, formatTime, todayVN } from '@/lib/client/api';
import { useFetch } from '@/lib/client/useFetch';
import { toSelect, useOptions } from '@/lib/client/options';
import { useCan } from '@/components/ViewerContext';
import { ErrorState, Notice, Spinner } from '@/components/ui';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ActionScreen } from '@/components/ui/record/ActionScreen';
import { ActionField } from '@/components/ui/record/fields';
import { useRecordContext } from '@/components/ui/record/context';
import type { ActionCtx } from '@/components/ui/record/RecordModal';
import type { CalibrationRecord, CalibrationResult, SubEquipmentRow } from '@/lib/types';

type Fields = {
  calibrated_at: string; result: CalibrationResult; vendor_id: string; cert_no: string; cert_file_url: string; remark: string; due_date: string;
};

function ResultRadios({ value, onChange }: { value: CalibrationResult; onChange: (v: CalibrationResult) => void }) {
  const { t } = useTranslation();
  return (
    <div className="dp-radios" role="radiogroup" aria-label={t('fields.result')}>
      {(['pass', 'fail'] as const).map((r) => (
        <label key={r}>
          <input type="radio" name="cal-result" value={r} checked={value === r} onChange={() => onChange(r)} />
          {t(`cal.result.${r}`)}
        </label>
      ))}
    </div>
  );
}

/** Ô nhập chung của "Ghi nhận" và "Sửa một lần". */
function CalibrationFields({ value, onChange, dueNote, dueRequired }: {
  value: Fields; onChange: (patch: Partial<Fields>) => void; dueNote: string | null; dueRequired?: boolean;
}) {
  const { t } = useTranslation();
  const options = useOptions();
  return (
    <div className="dp-grid">
      <ActionField htmlFor="cal-date" label={t('fields.calibration_date')} required wide={false}>
        <input id="cal-date" type="date" required value={value.calibrated_at} max={todayVN()} onChange={(e) => onChange({ calibrated_at: e.target.value })} />
      </ActionField>
      <ActionField label={t('fields.result')} wide={false}>
        <ResultRadios value={value.result} onChange={(result) => onChange({ result })} />
      </ActionField>
      <ActionField label={t('fields.vendor')} wide={false}>
        <SearchableSelect value={value.vendor_id} onChange={(v) => onChange({ vendor_id: v })} clearable
          options={toSelect(options?.calibration_vendors, value.vendor_id, ` (${t('cfg.hidden')})`)}
          placeholder={t('dp.selectPlaceholder')} ariaLabel={t('fields.vendor')} />
      </ActionField>
      <ActionField htmlFor="cal-cert" label={t('fields.cert_no')} wide={false}>
        <input id="cal-cert" maxLength={200} value={value.cert_no} onChange={(e) => onChange({ cert_no: e.target.value })} />
      </ActionField>
      <ActionField htmlFor="cal-url" label={t('fields.cert_file_url')}>
        <input id="cal-url" type="url" maxLength={1000} value={value.cert_file_url} onChange={(e) => onChange({ cert_file_url: e.target.value })} />
      </ActionField>
      {dueRequired && (
        <ActionField htmlFor="cal-due" label={t('cal.newDueDate')} required hint={t('cal.noIntervalHint')}>
          <input id="cal-due" type="date" required value={value.due_date} min={value.calibrated_at} onChange={(e) => onChange({ due_date: e.target.value })} />
        </ActionField>
      )}
      {dueNote && <ActionField label={t('cal.newDueDate')}><span className="dp-value">{dueNote}</span></ActionField>}
      <ActionField htmlFor="cal-remark" label={t('fields.remark')}>
        <textarea id="cal-remark" rows={2} maxLength={1000} value={value.remark} onChange={(e) => onChange({ remark: e.target.value })} />
      </ActionField>
    </div>
  );
}

/** [Ghi nhận hiệu chuẩn]: lần hiệu chuẩn mới; Hạn mới tính theo Setup (part number chưa có Setup thì phải nhập hạn). */
export function RecordCalibrationScreen({ ctx }: { ctx: ActionCtx<SubEquipmentRow> }) {
  const { t } = useTranslation();
  const record = ctx.record;
  const [f, setF] = useState<Fields>({ calibrated_at: todayVN(), result: 'pass', vendor_id: '', cert_no: '', cert_file_url: '', remark: '', due_date: '' });
  const interval = record.interval_months;
  const computed = interval && f.calibrated_at ? addMonths(f.calibrated_at, interval) : null;
  const dirty = f.result !== 'pass' || f.vendor_id !== '' || f.cert_no !== '' || f.cert_file_url !== '' || f.remark !== '' || f.due_date !== '' || f.calibrated_at !== todayVN();
  const ready = f.calibrated_at !== '' && (!!interval || f.due_date !== '');
  return (
    <ActionScreen
      description={t('cal.recordDesc', { serial: record.serial_number })} onCancel={ctx.cancel} dirty={dirty}
      confirmLabel={t('cal.record')} confirmDisabled={!ready}
      onConfirm={async () => {
        const body: Record<string, unknown> = { calibrated_at: f.calibrated_at, result: f.result };
        if (f.vendor_id) body.vendor_id = f.vendor_id;
        if (f.cert_no.trim()) body.cert_no = f.cert_no.trim();
        if (f.cert_file_url.trim()) body.cert_file_url = f.cert_file_url.trim();
        if (f.remark.trim()) body.remark = f.remark.trim();
        if (!interval) body.due_date = f.due_date;
        const res = await api.post<{ sub_equipment: SubEquipmentRow }>(`/api/calibration/${record.id}/records`, body);
        ctx.reload();
        ctx.done(res.data.sub_equipment, t('cal.recorded'));
      }}
    >
      <CalibrationFields value={f} onChange={(patch) => setF((p) => ({ ...p, ...patch }))} dueRequired={!interval}
        dueNote={computed ? `${formatDate(computed)} · ${t('cal.everyMonths', { count: interval ?? 0 })}` : null} />
    </ActionScreen>
  );
}

/** [Sửa] một lần hiệu chuẩn nhập sai (mở từ tab Hiệu chuẩn). Admin xóa được lần đó. */
export function EditCalibrationScreen({ ctx, rec }: { ctx: ActionCtx<SubEquipmentRow>; rec: CalibrationRecord | null }) {
  const { t } = useTranslation();
  const can = useCan();
  const record = useRecordContext();
  const initial: Fields = {
    calibrated_at: rec?.calibrated_at ?? '', result: rec?.result ?? 'pass', vendor_id: rec?.vendor_id ?? '', cert_no: rec?.cert_no ?? '',
    cert_file_url: rec?.cert_file_url ?? '', remark: rec?.remark ?? '', due_date: rec?.due_date ?? '',
  };
  const [f, setF] = useState<Fields>(initial);
  if (!rec) return null;
  const changed = (['calibrated_at', 'result', 'vendor_id', 'cert_no', 'cert_file_url', 'remark'] as const).filter((k) => f[k] !== initial[k]);
  const interval = ctx.record.interval_months;
  const newDue = changed.includes('calibrated_at') && interval && f.calibrated_at ? addMonths(f.calibrated_at, interval) : null;
  return (
    <ActionScreen
      description={<>{t('cal.editDesc', { date: formatDate(rec.calibrated_at) })}{' '}
        {can.remove && (
          <button type="button" className="link" onClick={() => record?.requestLeave(() => record.openAction('remove-calibration'))}>
            {t('cal.removeRecord')}
          </button>
        )}</>}
      onCancel={ctx.cancel} dirty={changed.length > 0}
      confirmLabel={t('common.save')} confirmDisabled={changed.length === 0 || f.calibrated_at === ''}
      onConfirm={async () => {
        const body: Record<string, unknown> = {};
        for (const k of changed) {
          const v = f[k];
          body[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
        }
        const res = await api.put<{ sub_equipment: SubEquipmentRow }>(`/api/calibration/records/${rec.id}`, body);
        ctx.reload();
        ctx.done(res.data.sub_equipment, t('cal.recordUpdated'));
      }}
    >
      <CalibrationFields value={f} onChange={(patch) => setF((p) => ({ ...p, ...patch }))}
        dueNote={newDue ? formatDate(newDue) : `${formatDate(rec.due_date)} · ${t('cal.autoComputed')}`} />
    </ActionScreen>
  );
}

export function RemoveCalibrationScreen({ ctx, rec }: { ctx: ActionCtx<SubEquipmentRow>; rec: CalibrationRecord | null }) {
  const { t } = useTranslation();
  if (!rec) return null;
  return (
    <ActionScreen
      danger description={t('cal.removeDesc', { date: formatDate(rec.calibrated_at) })} onCancel={ctx.cancel}
      confirmLabel={t('cal.removeRecord')}
      onConfirm={async () => {
        const res = await api.delete<{ sub_equipment: SubEquipmentRow }>(`/api/calibration/records/${rec.id}`);
        ctx.reload();
        ctx.done(res.data.sub_equipment, t('cal.recordRemoved'));
      }}
    />
  );
}

/** Tab Hiệu chuẩn: mọi lần hiệu chuẩn, mới nhất trên cùng. Bấm một dòng → sửa lần đó (Admin, User). */
export function CalibrationRecordsTab({ subId, version, onEdit }: {
  subId: string; version: number; onEdit: (rec: CalibrationRecord) => void;
}) {
  const { t } = useTranslation();
  const can = useCan();
  const { data, error, reload } = useFetch<CalibrationRecord[]>(`/api/calibration/${subId}/records?_v=${version}`);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Spinner label={t('common.loadingEllipsis')} />;
  if (data.length === 0) return <p className="hist-empty">{t('cal.noRecords')}</p>;
  return (
    <div className="cal-tab">
      {can.edit && <Notice tone="info">{t('cal.recordsHint')}</Notice>}
      <div className="imp-table-wrap">
      <table className="imp-table cal-records">
        <thead>
          <tr>
            <th>{t('fields.calibration_date')}</th><th>{t('fields.due_date')}</th><th>{t('fields.vendor')}</th>
            <th>{t('fields.cert_no')}</th><th>{t('fields.result')}</th><th>{t('cal.recordedBy')}</th><th />
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.calibrated_at)}</td>
              <td>{formatDate(r.due_date)}</td>
              <td>{r.vendor ?? '—'}</td>
              <td>{r.cert_file_url
                ? <a className="link" href={r.cert_file_url} target="_blank" rel="noreferrer noopener">{r.cert_no ?? t('cal.certFile')}</a>
                : r.cert_no ?? '—'}</td>
              <td>{t(`cal.result.${r.result}`)}</td>
              <td title={formatTime(r.created_at)}>{r.created_by_name ?? '—'}</td>
              <td>{can.edit && (
                <button type="button" className="dp-icon-btn" onClick={() => onEdit(r)} aria-label={t('cal.editRecord')} title={t('cal.editRecord')}>
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
