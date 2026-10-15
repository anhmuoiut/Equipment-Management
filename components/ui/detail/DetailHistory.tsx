'use client';

/**
 * History tables shared by all record tabs and Dashboard Recent changes.
 * Each event is one row, with only its own changes in an expandable summary cell.
 */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime } from '@/lib/client/api';
import { useFetch } from '@/lib/client/useFetch';
import { ErrorState, Spinner } from '@/components/ui';
import { ReadonlyValue } from '@/components/ui/record/fields';
import type { HistoryChange, HistoryEntry } from '@/lib/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T/;

export function useFormatHistoryValue() {
  const { t } = useTranslation();
  function format(value: unknown): string {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
    if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
    if (Array.isArray(value)) return value.map(format).join(', ');
    if (typeof value === 'string' && DATE_RE.test(value)) return formatDate(value);
    if (typeof value === 'string' && TIME_RE.test(value)) return formatTime(value);
    if (typeof value === 'string') return t(`values.${value}`, { defaultValue: value });
    if (typeof value === 'object') return JSON.stringify(value) ?? String(value);
    return String(value);
  }
  return format;
}

/**
 * Ghi chú do database đặt: via_parent:SN (đổi theo thiết bị cha), swap_with:SN, parent_deleted:SN (cha bị xóa, con thành chưa gắn).
 */
export function useFormatNote() {
  const { t } = useTranslation();
  return (note: string | null): string | null => {
    if (!note) return null;
    const [kind, ...rest] = note.split(':');
    const value = rest.join(':');
    if (kind === 'via_parent') return t('hist.viaParent', { serial: value });
    if (kind === 'swap_with') return t('hist.swapWith', { serial: value });
    if (kind === 'parent_deleted') return t('hist.parentDeleted', { serial: value });
    return note;
  };
}

export function historyFieldLabel(key: string, fieldLabel: (key: string) => string): string {
  const direct = fieldLabel(key);
  if (direct !== key && direct !== `fields.${key}`) return direct;
  const alias = key === 'calibrated_at' ? 'calibration_date' : key.replace(/_id$/, '');
  const aliased = fieldLabel(alias);
  return aliased === alias || aliased === `fields.${alias}` ? direct : aliased;
}

export type HistoryTableRow = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  actionCode?: string;
  module?: ReactNode;
  record?: ReactNode;
  source?: ReactNode;
  note?: ReactNode;
  changes?: HistoryEntry['changes'] | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  itemCount?: number;
};

const AUDIT_FIELDS = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sub_equipment_id']);
const ACTION_FIELDS: Record<string, readonly string[]> = {
  CHANGE_LOCATION: ['location'],
  CHECK_OUT: ['usage'],
  CHECK_IN: ['usage'],
  MOVE: ['parent', 'tester', 'location', 'level', 'usage'],
  DETACH: ['parent', 'tester', 'location', 'level', 'usage'],
  SWAP: ['parent', 'tester', 'location', 'level', 'usage'],
  CALIBRATE: ['result', 'due_date', 'calibrated_at', 'calibration_date', 'vendor'],
  CALIBRATION_UPDATE: ['result', 'due_date', 'calibrated_at', 'calibration_date', 'vendor'],
  TAGS: ['tags'],
  ROLE_CHANGE: ['role'],
  ENABLE: ['is_active'],
  DISABLE: ['is_active'],
};

/** Compare stored values, keeping false/0 and ignoring object key order. */
function equalValues(left: unknown, right: unknown): boolean {
  if (left === right || (left == null && right == null)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalValues(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.hasOwn(b, key) && equalValues(a[key], b[key]));
  }
  return false;
}

export function rowChanges(row: Pick<HistoryTableRow, 'changes' | 'fromLocation' | 'toLocation' | 'actionCode'>): [string, HistoryChange][] {
  const changes = { ...row.changes };
  if (!changes.location && (row.fromLocation || row.toLocation)) {
    changes.location = { old: row.fromLocation ?? null, new: row.toLocation ?? null };
  }
  const entries = Object.entries(changes).filter(([key, change]) =>
    !AUDIT_FIELDS.has(key) && !equalValues(change.old, change.new));
  const priority = ACTION_FIELDS[row.actionCode ?? ''] ?? [];
  const rank = (key: string) => {
    const index = priority.indexOf(key.replace(/_id$/, ''));
    return index === -1 ? priority.length : index;
  };
  // Priority changes presentation only; keep every real change, including effects inherited from a parent.
  return entries.sort(([a], [b]) => rank(a) - rank(b));
}

function HistoryRowChanges({ row, fieldLabel }: {
  row: HistoryTableRow; fieldLabel: (key: string) => string;
}) {
  const { t } = useTranslation();
  const format = useFormatHistoryValue();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const batch = (row.itemCount ?? 1) > 1;
  const created = row.actionCode === 'CREATE';
  const deleted = row.actionCode === 'DELETE' || row.actionCode === 'CALIBRATION_REMOVE';
  const inserted = created || row.actionCode === 'CALIBRATE';
  const entries = batch ? [] : rowChanges(row);
  const visible = expanded ? entries : created || deleted ? [] : entries.slice(0, 2);
  const previewCount = created || deleted ? 0 : Math.min(2, entries.length);
  const hasNote = row.note !== undefined && row.note !== null && row.note !== '';
  const hasSource = row.source !== undefined && row.source !== null && row.source !== '';
  const hasDetails = entries.length > previewCount || hasNote || hasSource;
  const summary = batch ? t('hist.summary.imported', { count: row.itemCount })
    : created ? t('hist.summary.created')
      : deleted ? t('hist.summary.deleted')
        : entries.length === 0 ? row.action : null;

  return (
    <div className="hist-changes">
      <div id={contentId} className="hist-changes-content">
        {summary && <p className="hist-summary">{summary}</p>}
        {visible.length > 0 && (
          <dl className="hist-change-list">
            {visible.map(([key, change]) => {
              const label = historyFieldLabel(key, fieldLabel);
              return (
                <div key={key} className="hist-change">
                  <dt>{label}</dt>
                  <dd>
                    <ReadonlyValue label={label}>
                      {deleted ? <span>{format(change.old)}</span> : inserted
                        ? <span className="hist-new">{format(change.new)}</span>
                        : <><span className="hist-old">{format(change.old)}</span><span className="hist-arrow" aria-hidden="true"> → </span><span className="hist-new">{format(change.new)}</span></>}
                    </ReadonlyValue>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {expanded && (hasSource || hasNote) && (
          <dl className="hist-change-list hist-change-meta">
            {hasSource && <div className="hist-change"><dt>{t('hist.columns.source')}</dt><dd>{row.source}</dd></div>}
            {hasNote && <div className="hist-change"><dt>{t('hist.columns.note')}</dt><dd><ReadonlyValue label={t('hist.columns.note')}>{row.note}</ReadonlyValue></dd></div>}
          </dl>
        )}
      </div>
      {hasDetails && (
        <button type="button" className="hist-more" aria-expanded={expanded} aria-controls={contentId}
          aria-label={t(expanded ? 'hist.showLess' : 'hist.showMore', { action: row.action })}
          onClick={() => setExpanded((value) => !value)}>
          {t(expanded ? 'dp.showLess' : 'dp.showMore')}
        </button>
      )}
    </div>
  );
}

type HistoryColumn = {
  key: string;
  label: string;
  width: number;
  className?: string;
  render: (row: HistoryTableRow) => ReactNode;
};

/** Fixed columns: who did what, to which record, and the changes relevant to that event. */
export function HistoryTable({ rows, fieldLabel, ariaLabel, loading }: {
  rows: HistoryTableRow[];
  fieldLabel: (key: string) => string;
  ariaLabel: string;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const columns: HistoryColumn[] = [
    { key: 'time', label: t('hist.columns.time'), width: 166, className: 'hist-col-time',
      render: (row) => <time dateTime={row.createdAt}>{formatTime(row.createdAt)}</time> },
    { key: 'actor', label: t('hist.columns.actor'), width: 144,
      render: (row) => <ReadonlyValue label={t('hist.columns.actor')}>{row.actor}</ReadonlyValue> },
  ];
  if (rows.some((row) => row.module !== undefined && row.module !== null)) columns.push({
    key: 'module', label: t('hist.columns.module'), width: 128, render: (row) => row.module,
  });
  columns.push({
    key: 'record', label: t('hist.columns.record'), width: 180,
    render: (row) => <ReadonlyValue label={t('hist.columns.record')}>{row.record ?? '—'}</ReadonlyValue>,
  });
  columns.push(
    { key: 'action', label: t('hist.columns.action'), width: 184, className: 'hist-col-action', render: (row) => row.action },
    { key: 'changes', label: t('hist.columns.changes'), width: 400, className: 'hist-col-changes',
      render: (row) => <HistoryRowChanges row={row} fieldLabel={fieldLabel} /> },
  );

  return (
    <div className="hist-table-wrap" role="region" tabIndex={0} aria-label={ariaLabel} aria-busy={loading || undefined}>
      <table className="hist-table" aria-label={ariaLabel} style={{ minWidth: columns.reduce((sum, column) => sum + column.width, 0) }}>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-action={row.actionCode}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row) ?? <span className="hist-empty-cell">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailHistory({ url, fieldLabel, filter }: {
  url: string;
  fieldLabel: (key: string) => string;
  /** Bộ lọc nhanh, ví dụ "Chỉ lần hiệu chuẩn" (thêm ?only=…). */
  filter?: { label: string; param: string };
}) {
  const { t } = useTranslation();
  const formatNote = useFormatNote();
  const [filtered, setFiltered] = useState(false);
  const { data: rows, loading, error, reload } = useFetch<HistoryEntry[]>(filtered && filter ? `${url}?${filter.param}` : url);

  let body: ReactNode;
  if (error) body = <ErrorState message={error} onRetry={reload} />;
  else if (!rows) body = <Spinner label={t('common.loadingEllipsis')} />;
  else if (rows.length === 0) body = <p className="hist-empty">{t('hist.empty')}</p>;
  else {
    body = <HistoryTable ariaLabel={t('dp.tabHistory')} loading={loading} fieldLabel={fieldLabel}
      rows={rows.map((row) => ({
        id: row.id, createdAt: row.created_at, actor: row.created_by_name ?? t('hist.system'),
        action: t(`hist.action.${row.action}`, { defaultValue: row.action }), actionCode: row.action,
        record: row.label, source: t(`hist.source.${row.source}`, { defaultValue: row.source }),
        note: formatNote(row.note), changes: row.changes,
        fromLocation: row.from_location, toLocation: row.to_location,
      }))} />;
  }

  return (
    <div className="hist">
      {filter && (
        <label className="hist-filter">
          <input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} />
          {filter.label}
        </label>
      )}
      {body}
    </div>
  );
}
