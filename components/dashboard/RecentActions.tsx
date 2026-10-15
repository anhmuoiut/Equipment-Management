'use client';

/**
 * "Thay đổi gần đây" của Dashboard: MỘT thao tác của người dùng = MỘT dòng (view recent_actions, gộp theo action_id).
 * Mỗi dòng: Thời gian · Người thao tác · một câu mô tả dễ đọc ("Swapped Fx_02 ⇄ FIXTURE_000004") với tên từng bản ghi là liên kết,
 * một dòng tóm tắt, và chi tiết từng bản ghi (cũ → mới) sau nút "Xem thêm". Module hiện thành nhãn nhỏ.
 */
import { Fragment, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDate } from '@/lib/client/api';
import { usePhone } from '@/lib/client/usePhone';
import { historyFieldLabel, rowChanges, useFormatHistoryValue, useFormatNote } from '@/components/ui/detail/DetailHistory';
import type { ActionRecord, HistoryChange, HistoryModule, RecentAction } from '@/lib/types';

const MODULE_PATH: Record<HistoryModule, string> = {
  equipment: '/equipment', sub_equipment: '/calibration', golden_board: '/golden', user: '/users',
};
/** Bản ghi đi theo thao tác chính (con cháu đổi theo cha, con của cha bị xóa) — database đánh dấu bằng ghi chú. */
const FOLLOWER = /^(via_parent|parent_deleted):/;
/** Hành động nào được coi là "việc chính" của thao tác khi có nhiều loại (trên xuống). UPDATE xếp sau vì con cháu đổi Level cũng ghi UPDATE. */
const LEAD_ORDER = ['SWAP', 'DELETE', 'MOVE', 'DETACH', 'CHANGE_LOCATION', 'CHECK_OUT', 'CHECK_IN', 'CREATE', 'CALIBRATE',
  'CALIBRATION_UPDATE', 'CALIBRATION_REMOVE', 'UPDATE', 'TAGS', 'ROLE_CHANGE', 'PASSWORD_RESET', 'DISABLE', 'ENABLE'];
const SHIFT = ['MOVE', 'DETACH', 'CHANGE_LOCATION'];
const CREATE_FIELDS = ['part_number', 'type', 'location', 'parent', 'tester'];
// Match the audit date formatter's timezone, with the clock and date on separate lines.
const CLOCK_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
});

/** Một bản ghi sau khi gộp các dòng nhật ký của chính nó trong thao tác (sửa form có thể ghi hai dòng cho cùng một thiết bị). */
type Merged = {
  key: string; module: HistoryModule; object_id: string; label: string;
  actions: string[]; changes: Record<string, HistoryChange>; notes: string[]; follower: boolean;
  from: string | null | undefined; to: string | null | undefined;
};

function mergeRecords(records: ActionRecord[]): Merged[] {
  const map = new Map<string, Merged>();
  for (const r of records) {
    const follower = !!r.note && FOLLOWER.test(r.note);
    let m = map.get(`${r.module}:${r.object_id}`);
    if (!m) {
      m = { key: `${r.module}:${r.object_id}`, module: r.module, object_id: r.object_id, label: r.label, actions: [], changes: {}, notes: [],
        follower, from: r.from_location, to: r.to_location };
      map.set(m.key, m);
    } else {
      m.follower = m.follower && follower;
      m.label = r.label;
      m.to = r.to_location ?? m.to;
    }
    if (!m.actions.includes(r.action)) m.actions.push(r.action);
    if (r.note && !m.notes.includes(r.note)) m.notes.push(r.note);
    for (const [key, change] of Object.entries(r.changes ?? {})) m.changes[key] = m.changes[key] ? { old: m.changes[key]!.old, new: change.new } : change;
  }
  return [...map.values()];
}

/** Câu mô tả có chỗ trống {{a}} / {{b}} để chèn liên kết: dịch với dấu hiệu thay vì chữ, rồi thay dấu hiệu bằng phần tử. */
const mark = (key: string) => `\u0001${key}\u0001`;
function fill(template: string, slots: Record<string, ReactNode>): ReactNode {
  return template.split(/\u0001(\w+)\u0001/).map((part, i) => (i % 2 === 0 ? part : <Fragment key={i}>{slots[part]}</Fragment>));
}

const shown = (value: unknown) => (value === null || value === undefined ? null : String(value));

type Described = { lead: string; sentence: ReactNode; summary: string | null; merged: Merged[]; related: number };

/** Một thao tác → câu mô tả + dòng tóm tắt. Thuần túy (không hook) — `t` và `format` do chỗ gọi đưa vào. */
function describe(
  action: RecentAction, t: TFunction, format: (value: unknown) => string, fieldLabel: (key: string) => string,
): Described {
  const merged = mergeRecords(action.records);
  const main = merged.filter((m) => !m.follower);
  const codes = new Set((main.length ? main : merged).flatMap((m) => m.actions));
  // Sửa form vừa đổi cha / vị trí vừa sửa trường (cùng một thiết bị có cả UPDATE lẫn MOVE…) = "Updated".
  const edit = merged.some((m) => !m.follower && m.actions.includes('UPDATE') && m.actions.some((a) => SHIFT.includes(a)));
  const lead = codes.has('SWAP') ? 'SWAP' : codes.has('DELETE') ? 'DELETE' : edit ? 'UPDATE' : LEAD_ORDER.find((c) => codes.has(c)) ?? action.action;
  const primary = (() => {
    const own = merged.filter((m) => !m.follower && m.actions.includes(lead));
    return own.length ? own : merged.filter((m) => m.actions.includes(lead));
  })();
  const related = Math.max(0, merged.length - primary.length);

  const link = (m: Merged | undefined) => {
    if (!m) return '—';
    const path = MODULE_PATH[m.module];
    return path && !m.actions.includes('DELETE')
      ? <Link className="link" href={`${path}?id=${m.object_id}`}>{m.label}</Link>
      : <strong>{m.label}</strong>;
  };
  const first = primary[0];
  const slots = { a: mark('a'), b: mark('b') };
  const parentOf = (m: Merged | undefined, side: 'old' | 'new') => shown(m?.changes.parent?.[side] ?? m?.changes.tester?.[side]);
  const imported = action.source === 'import' && lead === 'CREATE';

  let sentence: ReactNode;
  let summary: string | null = null;
  const changeLine = (m: Merged | undefined, code: string, mode: 'both' | 'new' = 'both') => (m
    ? rowChanges({ changes: m.changes, fromLocation: m.from, toLocation: m.to, actionCode: code }).slice(0, 2)
      .map(([key, change]) => `${historyFieldLabel(key, fieldLabel)}: ${mode === 'new' ? format(change.new) : `${format(change.old)} → ${format(change.new)}`}`)
    : []);

  switch (lead) {
    case 'SWAP': {
      const partner = first?.notes.find((n) => n.startsWith('swap_with:'))?.slice('swap_with:'.length);
      sentence = fill(t('hist.act.swapped', slots), { a: link(first), b: primary[1] ? link(primary[1]) : <strong>{partner ?? '—'}</strong> });
      summary = primary.length > 1 ? t('hist.act.swappedCount', { count: primary.length }) : changeLine(first, lead).join(' · ') || null;
      break;
    }
    case 'MOVE': {
      const parent = parentOf(first, 'new');
      sentence = parent ? fill(t('hist.act.moved', slots), { a: link(first), b: <strong>{parent}</strong> }) : fill(t('hist.act.movedNoParent', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    }
    case 'DETACH': {
      const parent = parentOf(first, 'old');
      sentence = parent ? fill(t('hist.act.detached', slots), { a: link(first), b: <strong>{parent}</strong> }) : fill(t('hist.act.detachedNoParent', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    }
    case 'CHANGE_LOCATION':
      sentence = fill(t('hist.act.locationChanged', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    case 'CHECK_OUT':
    case 'CHECK_IN': {
      const out = lead === 'CHECK_OUT';
      const more = primary.length - 1;
      sentence = fill(more > 0
        ? t(out ? 'hist.act.checkedOutMore' : 'hist.act.checkedInMore', { ...slots, count: more })
        : t(out ? 'hist.act.checkedOut' : 'hist.act.checkedIn', slots), { a: link(first) });
      const usage = first?.changes.usage;
      summary = [t('hist.act.assetsCount', { count: primary.length }), usage ? `${format(usage.old)} → ${format(usage.new)}` : null].filter(Boolean).join(' · ');
      break;
    }
    case 'CREATE': {
      if (imported) {
        const key = action.module === 'equipment' ? 'importedEquipment' : action.module === 'sub_equipment' ? 'importedSubEquipment' : action.module === 'golden_board' ? 'importedGolden' : 'importedOther';
        sentence = t(`hist.act.${key}`, { count: action.item_count });
      } else {
        sentence = fill(t('hist.act.created', slots), { a: link(first) });
        summary = CREATE_FIELDS.map((key) => first?.changes[key]?.new).filter((v) => v !== null && v !== undefined && v !== '').slice(0, 3).map(format).join(' · ') || null;
      }
      break;
    }
    case 'DELETE':
      sentence = fill(t('hist.act.deleted', slots), { a: link(first) });
      break;
    case 'CALIBRATE':
    case 'CALIBRATION_UPDATE':
    case 'CALIBRATION_REMOVE':
      sentence = fill(t(lead === 'CALIBRATE' ? 'hist.act.calibrated' : lead === 'CALIBRATION_UPDATE' ? 'hist.act.calibrationUpdated' : 'hist.act.calibrationRemoved', slots), { a: link(first) });
      summary = lead === 'CALIBRATION_REMOVE' ? null
        : rowChanges({ changes: first?.changes, fromLocation: null, toLocation: null, actionCode: lead }).slice(0, 3)
          .map(([key, change]) => `${historyFieldLabel(key, fieldLabel)}: ${format(change.new)}`).join(' · ') || null;
      break;
    case 'TAGS':
      sentence = fill(t('hist.act.tagsChanged', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    case 'ROLE_CHANGE':
      sentence = fill(t('hist.act.roleChanged', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    case 'ENABLE':
    case 'DISABLE':
      sentence = fill(t(lead === 'ENABLE' ? 'hist.act.enabled' : 'hist.act.disabled', slots), { a: link(first) });
      break;
    case 'PASSWORD_RESET':
      sentence = fill(t('hist.act.passwordReset', slots), { a: link(first) });
      break;
    case 'UPDATE':
      sentence = fill(t('hist.act.updated', slots), { a: link(first) });
      summary = changeLine(first, lead).join(' · ') || null;
      break;
    default:
      sentence = fill(t('hist.act.other', { ...slots, action: t(`hist.action.${lead}`, { defaultValue: lead }) }), { a: link(first) });
  }
  // Nhiều bản ghi chính cùng loại việc (ví dụ cùng lúc sửa nhiều thiết bị) mà câu chỉ nhắc một: ghi thêm "và N mục khác".
  if (!imported && lead !== 'SWAP' && lead !== 'CHECK_OUT' && lead !== 'CHECK_IN' && primary.length > 1) {
    sentence = <>{sentence} {t('hist.act.andMore', { count: primary.length - 1 })}</>;
  }
  if (related > 0) summary = [summary, t('hist.act.related', { count: related })].filter(Boolean).join(' · ');
  return { lead, sentence, summary, merged, related };
}

/** Reusable detail group for every record/module; full values and audit notes remain visible. */
function RecordDetails({ merged, primaryAction, fieldLabel }: {
  merged: Merged; primaryAction: string; fieldLabel: (key: string) => string;
}) {
  const { t } = useTranslation();
  const format = useFormatHistoryValue();
  const formatNote = useFormatNote();
  const headingId = useId();
  const inserted = merged.actions.includes('CREATE') || merged.actions.includes('CALIBRATE');
  const deleted = merged.actions.includes('DELETE') || merged.actions.includes('CALIBRATION_REMOVE');
  const entries = rowChanges({ changes: merged.changes, fromLocation: merged.from, toLocation: merged.to, actionCode: merged.actions[0] });
  const path = MODULE_PATH[merged.module];
  const additionalActions = merged.actions.filter((action) => action !== primaryAction);
  return (
    <li className="act-rec" data-follower={merged.follower || undefined} aria-labelledby={headingId}>
      <div className="act-rec-head">
        <h3 id={headingId} className="act-rec-title">
          {path && !merged.actions.includes('DELETE')
            ? <Link className="link" href={`${path}?id=${merged.object_id}`}>{merged.label}</Link> : merged.label}
        </h3>
        {additionalActions.length > 0 && <p className="act-rec-action">{additionalActions.map((a) => t(`hist.action.${a}`, { defaultValue: a })).join(' · ')}</p>}
      </div>
      {entries.length > 0 && (
        <dl className="hist-change-list">
          {entries.map(([key, change]) => {
            const label = historyFieldLabel(key, fieldLabel);
            return (
              <div key={key} className="hist-change">
                <dt>{label}</dt>
                <dd className="act-change-values">
                  {deleted ? <span>{format(change.old)}</span> : inserted ? <span className="hist-new">{format(change.new)}</span>
                    : <>
                      <span className="hist-old"><span className="sr-only">{t('hist.act.previousValue')}: </span>{format(change.old)}</span>
                      <span className="hist-arrow" aria-hidden="true"> → </span>
                      <span className="hist-new"><span className="sr-only">{t('hist.act.newValue')}: </span>{format(change.new)}</span>
                    </>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {merged.notes.map((note) => <p key={note} className="act-rec-note">{formatNote(note)}</p>)}
    </li>
  );
}

function ActionTimestamp({ createdAt }: { createdAt: string }) {
  return (
    <time className="act-timestamp" dateTime={createdAt}>
      <span className="act-time">{CLOCK_FORMAT.format(new Date(createdAt))}</span>
      <span className="act-date">{formatDate(createdAt)}</span>
    </time>
  );
}

function ActionRow({ action, phone }: { action: RecentAction; phone: boolean }) {
  const { t } = useTranslation();
  const format = useFormatHistoryValue();
  const contentId = useId();
  const [detailState, setDetailState] = useState<'unopened' | 'expanded' | 'collapsed'>('unopened');
  const expanded = detailState === 'expanded';
  const fieldLabel = (key: string) => t(`fields.${key}`, { defaultValue: key });
  const { lead, sentence, summary, merged } = describe(action, t, format, fieldLabel);
  const hasDetails = merged.length > 1 || merged.some((m) => Object.keys(m.changes).length > 0 || m.notes.length > 0);
  const missing = Math.max(0, action.item_count - action.records.length);
  const actionName = t(`hist.action.${lead}`, { defaultValue: lead });
  // Presentation order only: keep the primary pair together before records that followed them.
  const primary = merged.filter((record) => !record.follower && record.actions.includes(lead));
  const related = merged.filter((record) => record.follower || !record.actions.includes(lead));
  const actor = action.created_by_name ?? t('hist.system');
  // Long field values belong in the full details; keep the collapsed context useful and compact.
  const context = summary && summary.length > 180 && hasDetails
    ? [t('hist.act.fieldsChanged', { count: merged.reduce((count, record) => count + rowChanges({
      changes: record.changes, fromLocation: record.from, toLocation: record.to, actionCode: record.actions[0],
    }).length, 0) }), t('hist.act.recordsCount', { count: merged.length })].join(' · ')
    : summary;

  return (
    <tr data-action={lead}>
      {phone ? (
        <td className="act-meta">
          <ActionTimestamp createdAt={action.created_at} />
          <div className="act-actor">
            <span className="act-actor-label">{t('hist.columns.actor')}</span>
            <span className="act-actor-name">{actor}</span>
          </div>
        </td>
      ) : (
        <>
          <td className="act-meta"><ActionTimestamp createdAt={action.created_at} /></td>
          <td className="act-actor-name">{actor}</td>
        </>
      )}
      <td className="act-cell">
        <div className="act-content">
          <div className="act-head">
            <p className="act-sentence">{sentence}</p>
            <div className="act-context">
              <span className="act-module" data-module={action.module}>{t(`dash.moduleName.${action.module}`)}</span>
              {context && <p className="act-sub">{context}</p>}
            </div>
          </div>
          {hasDetails && (
            <button type="button" className="hist-more" aria-expanded={expanded} aria-controls={contentId}
              aria-label={t(expanded ? 'hist.showLess' : 'hist.showMore', { action: actionName })}
              onClick={() => setDetailState(expanded ? 'collapsed' : 'expanded')}>
              {t(expanded ? 'dp.showLess' : 'dp.showMore')}
            </button>
          )}
          {hasDetails && (
            <div id={contentId} className="act-details" data-expanded={expanded || undefined} aria-hidden={!expanded} inert={!expanded}>
              <div className="act-details-inner">
                {detailState !== 'unopened' && <>
                  <ul className="act-records" aria-label={t('hist.act.records')}>
                    {[...primary, ...related].map((m) => <RecordDetails key={m.key} merged={m} primaryAction={lead} fieldLabel={fieldLabel} />)}
                  </ul>
                  {missing > 0 && <p className="act-sub">{t('hist.act.moreRecords', { count: missing })}</p>}
                </>}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function RecentActionsTable({ actions, ariaLabel, loading }: { actions: RecentAction[]; ariaLabel: string; loading?: boolean }) {
  const { t } = useTranslation();
  const phone = usePhone();
  return (
    <div className="hist-table-wrap" role="region" tabIndex={0} aria-label={ariaLabel} aria-busy={loading || undefined}>
      <table className="hist-table act-table" aria-label={ariaLabel}>
        <colgroup>
          {phone ? <col className="act-meta-col" /> : <><col className="act-time-col" /><col className="act-by-col" /></>}
          <col />
        </colgroup>
        <thead>
          <tr>
            {phone ? <th scope="col">{t('hist.act.dateBy')}</th> : <>
              <th scope="col">{t('hist.columns.time')}</th>
              <th scope="col">{t('hist.columns.actor')}</th>
            </>}
            <th scope="col">{t('hist.act.column')}</th>
          </tr>
        </thead>
        <tbody>{actions.map((action) => <ActionRow key={action.id} action={action} phone={phone} />)}</tbody>
      </table>
    </div>
  );
}
