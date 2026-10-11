'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime } from '@/lib/client/api';
import { Notice, Spinner } from '@/components/ui';
import { useFormatNote } from '@/components/ui/detail/DetailHistory';
import { UsageTag } from '@/components/ui/tags';
import type { AssetOpResult, AssetType, HistoryChange } from '@/lib/types';

type SelectedAsset = { type: AssetType; id: string; label: string };
type PreviewGroup = {
  key: string;
  label: string;
  fields: Map<string, HistoryChange>;
  notes: Set<string>;
};

const AUDIT_FIELDS = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sub_equipment_id']);
const FIELD_ORDER = ['location', 'parent', 'tester', 'level', 'usage'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T/;
const assetKey = (type: AssetType, id: string) => `${type}:${id}`;

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

/** Merge logs for the same asset so each changed field appears once. */
function previewGroups(result: AssetOpResult): PreviewGroup[] {
  const groups = new Map<string, PreviewGroup>();
  function group(type: AssetType, id: string, label: string): PreviewGroup {
    const key = assetKey(type, id);
    let value = groups.get(key);
    if (!value) {
      value = { key, label, fields: new Map(), notes: new Set() };
      groups.set(key, value);
    }
    return value;
  }
  function merge(target: PreviewGroup, key: string, old: unknown, next: unknown) {
    if (AUDIT_FIELDS.has(key) || equalValues(old, next)) return;
    const previous = target.fields.get(key);
    target.fields.set(key, { old: previous ? previous.old : old, new: next });
  }

  for (const change of result.changes) {
    const target = group(change.asset_type, change.asset_id, change.label);
    const old = change.old_value ?? {};
    const next = change.new_value ?? {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      merge(target, key, old[key] ?? null, next[key] ?? null);
    }
    if (!Object.hasOwn(old, 'location') && !Object.hasOwn(next, 'location')
      && !Object.hasOwn(old, 'location_id') && !Object.hasOwn(next, 'location_id')) {
      merge(target, 'location', change.from_location ?? null, change.to_location ?? null);
    }
    if (change.reason) target.notes.add(change.reason);
  }
  for (const change of result.usage_changes) {
    const target = group(change.asset_type, change.asset_id, change.label);
    if (!target.fields.has('usage')) merge(target, 'usage', change.from, change.to);
  }
  for (const target of groups.values()) {
    for (const [key, change] of target.fields) {
      if (equalValues(change.old, change.new)) target.fields.delete(key);
    }
  }
  return [...groups.values()].filter((target) => target.fields.size > 0);
}

function SwapPreviewContent({ result, selected }: { result: AssetOpResult; selected: SelectedAsset[] }) {
  const { t } = useTranslation();
  const formatNote = useFormatNote();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const groups = previewGroups(result);
  const order = new Map(selected.map((asset, index) => [assetKey(asset.type, asset.id), index]));
  const primary = selected.length
    ? groups.filter((group) => order.has(group.key)).sort((a, b) => order.get(a.key)! - order.get(b.key)!)
    : groups.slice(0, 2);
  const primaryKeys = new Set(primary.map((group) => group.key));
  const others = groups.filter((group) => !primaryKeys.has(group.key));
  const visible = expanded ? [...primary, ...others] : primary;

  function label(key: string): string {
    const alias = key === 'calibrated_at' ? 'calibration_date' : key.replace(/_id$/, '');
    return t(`fields.${alias}`, { defaultValue: alias });
  }
  function format(value: unknown): string {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '—';
    if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
    if (Array.isArray(value)) return value.map(format).join(', ');
    if (typeof value === 'string' && DATE_RE.test(value)) return formatDate(value);
    if (typeof value === 'string' && TIME_RE.test(value)) return formatTime(value);
    if (typeof value === 'string') return t(`values.${value}`, { defaultValue: value });
    return typeof value === 'object' ? JSON.stringify(value) ?? String(value) : String(value);
  }
  function value(key: string, raw: unknown) {
    return key === 'usage' && (raw === 'in_use' || raw === 'not_in_use')
      ? <UsageTag usage={raw} /> : format(raw);
  }
  function rank(key: string) {
    const index = FIELD_ORDER.indexOf(key.replace(/_id$/, ''));
    return index === -1 ? FIELD_ORDER.length : index;
  }

  if (!groups.length) return <p className="dp-empty">{t('asset.nothingChanges')}</p>;
  return (
    <>
      <ul id={listId} className="swap-preview-list">
        {visible.map((group) => (
          <li key={group.key} className="swap-preview-item">
            <strong className="swap-preview-serial">{selected.find((asset) => assetKey(asset.type, asset.id) === group.key)?.label ?? group.label}</strong>
            <dl className="swap-preview-fields">
              {[...group.fields].sort(([a], [b]) => rank(a) - rank(b)).map(([key, change]) => (
                <div key={key} className="swap-preview-field">
                  <dt>{label(key)}</dt>
                  <dd>
                    <span className="swap-before">{value(key, change.old)}</span>
                    <span className="swap-value-arrow" aria-hidden="true"> → </span>
                    <span className="swap-after">{value(key, change.new)}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {!primaryKeys.has(group.key) && [...group.notes].map((note) => (
              <p key={note} className="swap-preview-note">{formatNote(note)}</p>
            ))}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <button type="button" className="swap-preview-more" aria-expanded={expanded} aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}>
          {expanded ? t('dp.showLess') : t('swap.affectedOthers', { count: others.length })}
        </button>
      )}
    </>
  );
}

/** Presentation of the existing Swap dry-run response, including affected descendants. */
export function SwapPreview({ state, selected }: {
  state: { result: AssetOpResult | null; loading: boolean; error: string | null };
  selected: SelectedAsset[];
}) {
  const { t } = useTranslation();
  if (!state.result && !state.loading && !state.error) return null;
  return (
    <section className="swap-preview" aria-live="polite" aria-busy={state.loading || undefined}>
      <h3 className="dp-section-title">{t('swap.after')}</h3>
      {state.loading ? <Spinner size="sm" label={t('asset.resultLoading')} />
        : state.error ? <Notice tone="alert">{state.error}</Notice>
          : state.result && <SwapPreviewContent key={selected.map((asset) => assetKey(asset.type, asset.id)).join('|')}
            result={state.result} selected={selected} />}
    </section>
  );
}
