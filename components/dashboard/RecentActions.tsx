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
import { formatTime } from '@/lib/client/api';
import { ReadonlyValue } from '@/components/ui/record/fields';
import { historyFieldLabel, rowChanges, useFormatHistoryValue, useFormatNote } from '@/components/ui/detail/DetailHistory';
import type { ActionRecord, HistoryChange, HistoryModule, RecentAction } from '@/lib/types';

const MODULE_PATH: Record<HistoryModule, string | null> = {
  equipment: '/equipment', sub_equipment: '/calibration', golden_board: '/golden', configuration: null, user: '/users',
};
/** Bản ghi đi theo thao tác chính (con cháu đổi theo cha, con của cha bị xóa) — database đánh dấu bằng ghi chú. */
const FOLLOWER = /^(via_parent|parent_deleted):/;
/** Hành động nào được coi là "việc chính" của thao tác khi có nhiều loại (trên xuống). UPDATE xếp sau vì con cháu đổi Level cũng ghi UPDATE. */
const LEAD_ORDER = ['SWAP', 'DELETE', 'MOVE', 'DETACH', 'CHANGE_LOCATION', 'CHECK_OUT', 'CHECK_IN', 'CREATE', 'CALIBRATE',
  'CALIBRATION_UPDATE', 'CALIBRATION_REMOVE', 'UPDATE', 'TAGS', 'ROLE_CHANGE', 'PASSWORD_RESET', 'DISABLE', 'ENABLE'];
const SHIFT = ['MOVE', 'DETACH', 'CHANGE_LOCATION'];
const CREATE_FIELDS = ['part_number', 'type', 'location', 'parent', 'tester'];

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
  const pair = (key: string) => {
    const [x, y] = [primary[0]?.changes[key]?.old, primary[1]?.changes[key]?.old];
    return x == null && y == null || x === y ? null : `${format(x)} ⇄ ${format(y)}`;
  };
  const changeLine = (m: Merged | undefined, code: string, mode: 'both' | 'new' = 'both') => (m
    ? rowChanges({ changes: m.changes, fromLocation: m.from, toLocation: m.to, actionCode: code }).slice(0, 2)
      .map(([key, change]) => `${historyFieldLabel(key, fieldLabel)}: ${mode === 'new' ? format(change.new) : `${format(change.old)} → ${format(change.new)}`}`)
    : []);

  switch (lead) {
    case 'SWAP': {
      const partner = first?.notes.find((n) => n.startsWith('swap_with:'))?.slice('swap_with:'.length);
      sentence = fill(t('hist.act.swapped', slots), { a: link(first), b: primary[1] ? link(primary[1]) : <strong>{partner ?? '—'}</strong> });
      // Hai bên: "cha A ⇄ cha B · vị trí A ⇄ vị trí B" (giá trị TRƯỚC khi đổi chỗ). Dòng cũ chỉ có một bên: hiện thay đổi của bên đó.
      summary = (primary.length > 1 ? [pair('parent') ?? pair('tester'), pair('location')].filter(Boolean) : changeLine(first, lead)).join(' · ') || null;
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

function RecordDetails({ merged, hidden, fieldLabel }: { merged: Merged; hidden?: boolean; fieldLabel: (key: string) => string }) {
  const { t } = useTranslation();
  const format = useFormatHistoryValue();
  const formatNote = useFormatNote();
  const inserted = merged.actions.includes('CREATE') || merged.actions.includes('CALIBRATE');
  const deleted = merged.actions.includes('DELETE') || merged.actions.includes('CALIBRATION_REMOVE');
  const entries = rowChanges({ changes: merged.changes, fromLocation: merged.from, toLocation: merged.to, actionCode: merged.actions[0] });
  const path = MODULE_PATH[merged.module];
  return (
    <li className="act-rec" data-follower={merged.follower || undefined} hidden={hidden}>
      <div className="act-rec-head">
        {path && !merged.actions.includes('DELETE')
          ? <Link className="link" href={`${path}?id=${merged.object_id}`}>{merged.label}</Link> : <strong>{merged.label}</strong>}
        <span className="act-rec-action">{merged.actions.map((a) => t(`hist.action.${a}`, { defaultValue: a })).join(' · ')}</span>
        {merged.notes.map((note) => <span key={note} className="act-rec-note">{formatNote(note)}</span>)}
      </div>
      {entries.length > 0 && (
        <dl className="hist-change-list">
          {entries.map(([key, change]) => {
            const label = historyFieldLabel(key, fieldLabel);
            return (
              <div key={key} className="hist-change">
                <dt>{label}</dt>
                <dd>
                  <ReadonlyValue label={label}>
                    {deleted ? <span>{format(change.old)}</span> : inserted ? <span className="hist-new">{format(change.new)}</span>
                      : <><span className="hist-old">{format(change.old)}</span><span className="hist-arrow" aria-hidden="true"> → </span><span className="hist-new">{format(change.new)}</span></>}
                  </ReadonlyValue>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </li>
  );
}

function ActionRow({ action }: { action: RecentAction }) {
  const { t } = useTranslation();
  const format = useFormatHistoryValue();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const fieldLabel = (key: string) => t(`fields.${key}`, { defaultValue: key });
  const { lead, sentence, summary, merged } = describe(action, t, format, fieldLabel);
  const hasDetails = merged.length > 1 || merged.some((m) => Object.keys(m.changes).length > 0 || m.notes.length > 0);
  const missing = Math.max(0, action.item_count - action.records.length);
  const actionName = t(`hist.action.${lead}`, { defaultValue: lead });

  return (
    <tr data-action={lead}>
      <td className="hist-col-time"><time dateTime={action.created_at}>{formatTime(action.created_at)}</time></td>
      <td><ReadonlyValue label={t('hist.columns.actor')}>{action.created_by_name ?? t('hist.system')}</ReadonlyValue></td>
      <td className="act-cell">
        <div className="act-head">
          <span className="act-module" data-module={action.module}>{t(`dash.moduleName.${action.module}`)}</span>
          <span className="act-sentence">{sentence}</span>
        </div>
        {summary && <p className="act-sub">{summary}</p>}
        {hasDetails && (
          <button type="button" className="hist-more" aria-expanded={expanded} aria-controls={contentId}
            aria-label={t(expanded ? 'hist.showLess' : 'hist.showMore', { action: actionName })}
            onClick={() => setExpanded((value) => !value)}>
            {t(expanded ? 'dp.showLess' : 'dp.showMore')}
          </button>
        )}
        {expanded && (
          <div id={contentId}>
            <ul className="act-records" aria-label={t('hist.act.records')}>
              {merged.map((m) => <RecordDetails key={m.key} merged={m} fieldLabel={fieldLabel} />)}
            </ul>
            {missing > 0 && <p className="act-sub">{t('hist.act.moreRecords', { count: missing })}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

export function RecentActionsTable({ actions, ariaLabel, loading }: { actions: RecentAction[]; ariaLabel: string; loading?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="hist-table-wrap" role="region" tabIndex={0} aria-label={ariaLabel} aria-busy={loading || undefined}>
      <table className="hist-table act-table" aria-label={ariaLabel} style={{ minWidth: 166 + 144 + 360 }}>
        <colgroup><col style={{ width: 166 }} /><col style={{ width: 144 }} /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col">{t('hist.columns.time')}</th>
            <th scope="col">{t('hist.columns.actor')}</th>
            <th scope="col">{t('hist.act.column')}</th>
          </tr>
        </thead>
        <tbody>{actions.map((action) => <ActionRow key={action.id} action={action} />)}</tbody>
      </table>
    </div>
  );
}
